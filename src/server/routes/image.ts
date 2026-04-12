import { createReadStream } from 'node:fs';
import { access, constants, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { getThumbnailPath, THUMBNAIL_TIERS } from '../../services/thumbnail.js';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  v: z.string().optional(),
  db: z.string().optional(),
});

const CONTENT_TYPE_JPEG = 'image/jpeg';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: CONTENT_TYPE_JPEG,
  jpeg: CONTENT_TYPE_JPEG,
  png: 'image/png',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export interface ImagePluginOptions {
  db: Database.Database;
}

interface PrimaryFileInfo {
  fileId: number;
  name: string;
  extension: string | null;
  dir: string;
}

function getPrimaryFile(
  db: BetterSQLite3Database<typeof schema>,
  mediaItemId: number,
): PrimaryFileInfo | undefined {
  const row = db
    .select({
      fileId: schema.file.id,
      name: schema.file.name,
      extension: schema.file.extension,
      dir: schema.path.dir,
    })
    .from(schema.mediaItemFile)
    .innerJoin(schema.file, eq(schema.file.id, schema.mediaItemFile.fileId))
    .innerJoin(schema.path, eq(schema.path.id, schema.file.pathId))
    .where(
      and(
        eq(schema.mediaItemFile.mediaItemId, mediaItemId),
        eq(schema.mediaItemFile.isPrimary, true),
      ),
    )
    .get();

  return row ?? undefined;
}

function buildFilePath(name: string, extension: string | null, dir: string): string {
  const ext = extension ? `.${extension}` : '';
  return join(dir, `${name}${ext}`);
}

function getContentType(extension: string | null): string {
  if (!extension) return 'application/octet-stream';
  return EXTENSION_CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the best-fit thumbnail for the requested dimensions.
 *
 * Strategy: pick the smallest tier whose width is >= the requested width.
 * If no tier is large enough, return the largest available tier.
 * If no thumbnails exist on disk, return undefined (caller falls back to original).
 */
async function selectBestThumbnail(
  primaryFilePath: string,
  requestedWidth: number,
): Promise<string | undefined> {
  const sortedTiers = [...THUMBNAIL_TIERS].sort((a, b) => a.width - b.width);

  for (const tier of sortedTiers) {
    const thumbPath = getThumbnailPath(primaryFilePath, tier.width);
    if (tier.width >= requestedWidth && await fileExists(thumbPath)) {
      return thumbPath;
    }
  }

  for (const tier of [...THUMBNAIL_TIERS].sort((a, b) => b.width - a.width)) {
    const thumbPath = getThumbnailPath(primaryFilePath, tier.width);
    if (await fileExists(thumbPath)) {
      return thumbPath;
    }
  }

  return undefined;
}

function getDbVersion(db: BetterSQLite3Database<typeof schema>): string | undefined {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'db_date'))
    .get();
  return row?.value ?? undefined;
}

/**
 * Image serving routes.
 *
 * - `GET /image/:id` — serve image by media item ID
 *
 * Supports `width`/`height` query params for thumbnail selection,
 * version-based caching via `v` and `db` query params, and falls
 * back to the original file when no suitable thumbnail exists.
 */
export const imagePlugin = fp<ImagePluginOptions>(
  async function imagePlugin(
    app: FastifyInstance,
    opts: ImagePluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    app.get('/image/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid image ID' });
      }
      const { id } = paramsParsed.data;

      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }
      const { width, height, v, db: dbParam } = queryParsed.data;

      const mediaItemRow = db
        .select()
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, id))
        .get();

      if (!mediaItemRow) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      if (v !== undefined && dbParam !== undefined) {
        const currentVersion = getDbVersion(db);
        if (currentVersion && v !== currentVersion) {
          const url = new URL(request.url, `http://${request.hostname}`);
          url.searchParams.set('v', currentVersion);
          url.searchParams.set('db', currentVersion);
          return reply.redirect(url.pathname + url.search, 301);
        }
      }

      const primary = getPrimaryFile(db, id);
      if (!primary) {
        return reply.code(404).send({ error: 'No primary file found for media item' });
      }

      const originalPath = buildFilePath(primary.name, primary.extension, primary.dir);

      let servePath: string;
      let contentType: string;

      if (width || height) {
        const requestedWidth = width ?? height ?? 0;
        const thumbnail = await selectBestThumbnail(originalPath, requestedWidth);
        if (thumbnail) {
          servePath = thumbnail;
          contentType = CONTENT_TYPE_JPEG;
        } else {
          servePath = originalPath;
          contentType = getContentType(primary.extension);
        }
      } else {
        servePath = originalPath;
        contentType = getContentType(primary.extension);
      }

      if (!await fileExists(servePath)) {
        return reply.code(404).send({ error: 'File not found on disk' });
      }

      const fileStat = await stat(servePath);

      return reply
        .type(contentType)
        .header('Last-Modified', fileStat.mtime.toUTCString())
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(servePath));
    });
  },
  { name: 'image-routes', dependencies: ['auth'] },
);
