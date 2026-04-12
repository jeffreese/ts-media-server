import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { listThumbnails } from '../../services/thumbnail.js';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  v: z.string().optional(),
  db: z.string().optional(),
});

export interface ThumbnailsPluginOptions {
  db: Database.Database;
}

interface PrimaryFileInfo {
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

function getDbVersion(db: BetterSQLite3Database<typeof schema>): string | undefined {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'db_date'))
    .get();
  return row?.value ?? undefined;
}

function checkVersionRedirect(
  request: FastifyRequest,
  reply: FastifyReply,
  db: BetterSQLite3Database<typeof schema>,
  v: string | undefined,
  dbParam: string | undefined,
): boolean {
  if (v === undefined || dbParam === undefined) return false;
  const currentVersion = getDbVersion(db);
  if (!currentVersion || v === currentVersion) return false;
  const url = new URL(request.url, `http://${request.hostname}`);
  url.searchParams.set('v', currentVersion);
  url.searchParams.set('db', currentVersion);
  void reply.redirect(url.pathname + url.search, 301);
  return true;
}

/**
 * Thumbnail listing: `GET /thumbnails/:id` returns available thumbnail
 * widths for a media item's primary file.
 *
 * Supports version-based caching via `v` and `db` query params (301 when stale).
 */
export const thumbnailsPlugin = fp<ThumbnailsPluginOptions>(
  async function thumbnailsPlugin(
    app: FastifyInstance,
    opts: ThumbnailsPluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    app.get('/thumbnails/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { id } = paramsParsed.data;

      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      const mediaItemRow = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, id))
        .get();

      if (!mediaItemRow) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      if (checkVersionRedirect(request, reply, db, queryParsed.data.v, queryParsed.data.db)) {
        return;
      }

      const primary = getPrimaryFile(db, id);
      if (!primary) {
        return reply.code(404).send({ error: 'No primary file found for media item' });
      }

      const filePath = buildFilePath(primary.name, primary.extension, primary.dir);
      const widths = await listThumbnails(filePath);

      return reply.send({ widths });
    });
  },
  { name: 'thumbnails-routes', dependencies: ['auth'] },
);
