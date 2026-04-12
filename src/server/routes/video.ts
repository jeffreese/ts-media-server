import { createReadStream } from 'node:fs';
import { access, constants, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { isVideoExtension } from '../../utils/file.js';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  v: z.string().optional(),
  db: z.string().optional(),
});

type VideoQuery = z.infer<typeof querySchema>;

const CONTENT_TYPE_MP4 = 'video/mp4';

export interface VideoPluginOptions {
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

/**
 * MP4 path for a video media item: same directory and basename as the primary
 * file, `.mp4` extension (matches `FileIndexService` sidecar output).
 */
function getMp4Path(primary: PrimaryFileInfo): string {
  return join(primary.dir, `${primary.name}.mp4`);
}

function getDbVersion(db: BetterSQLite3Database<typeof schema>): string | undefined {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'db_date'))
    .get();
  return row?.value ?? undefined;
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
 * Video serving: `GET /video/:id` streams the MP4 for a video media item.
 * Supports version-based caching via `v` and `db` query params (301 when stale).
 */
export const videoPlugin = fp<VideoPluginOptions>(
  async function videoPlugin(
    app: FastifyInstance,
    opts: VideoPluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    async function serveVideo(
      request: FastifyRequest,
      reply: FastifyReply,
      id: number,
      query: VideoQuery,
    ): Promise<void> {
      const { v, db: dbParam } = query;

      const mediaItemRow = db
        .select()
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, id))
        .get();

      if (!mediaItemRow) {
        return void reply.code(404).send({ error: 'Media item not found' });
      }

      if (mediaItemRow.type !== 'video') {
        return void reply.code(404).send({ error: 'Not a video media item' });
      }

      if (v !== undefined && dbParam !== undefined) {
        const currentVersion = getDbVersion(db);
        if (currentVersion && v !== currentVersion) {
          const url = new URL(request.url, `http://${request.hostname}`);
          url.searchParams.set('v', currentVersion);
          url.searchParams.set('db', currentVersion);
          return void reply.redirect(url.pathname + url.search, 301);
        }
      }

      const primary = getPrimaryFile(db, id);
      if (!primary) {
        return void reply.code(404).send({ error: 'No primary file found for media item' });
      }

      const ext = (primary.extension ?? '').toLowerCase();
      if (ext && !isVideoExtension(ext)) {
        return void reply.code(404).send({ error: 'Primary file is not a video' });
      }

      const mp4Path = getMp4Path(primary);

      if (!await fileExists(mp4Path)) {
        return void reply.code(404).send({ error: 'MP4 file not found on disk' });
      }

      const fileStat = await stat(mp4Path);

      return reply
        .type(CONTENT_TYPE_MP4)
        .header('Last-Modified', fileStat.mtime.toUTCString())
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(mp4Path));
    }

    app.get('/video/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid video ID' });
      }
      const { id } = paramsParsed.data;

      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      return serveVideo(request, reply, id, queryParsed.data);
    });
  },
  { name: 'video-routes', dependencies: ['auth'] },
);
