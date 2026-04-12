import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { FaceMatcher } from '../../services/face-matcher.js';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const versionQuerySchema = z.object({
  v: z.string().optional(),
  db: z.string().optional(),
});

const matchingFacesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const CONTENT_TYPE_JPEG = 'image/jpeg';

export interface FacePluginOptions {
  db: Database.Database;
}

function getDbVersion(db: BetterSQLite3Database<typeof schema>): string | undefined {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, 'db_date'))
    .get();
  return row?.value ?? undefined;
}

function thumbnailToBuffer(thumbnail: unknown): Buffer | null {
  if (thumbnail == null) return null;
  if (Buffer.isBuffer(thumbnail)) return thumbnail;
  if (thumbnail instanceof Uint8Array) return Buffer.from(thumbnail);
  return null;
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
 * Face thumbnail serving and transitive face matching API.
 *
 * - `GET /face/:id` — JPEG face crop from `feature.thumbnail` (BLOB)
 * - `GET /matchingFaces/:id` — distinct media items linked via `feature_match` (BFS, max depth 10)
 */
export const facePlugin = fp<FacePluginOptions>(
  async function facePlugin(
    app: FastifyInstance,
    opts: FacePluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });
    const faceMatcher = new FaceMatcher(db);

    app.get('/face/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid face feature ID' });
      }
      const { id } = paramsParsed.data;

      const queryParsed = versionQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      if (checkVersionRedirect(request, reply, db, queryParsed.data.v, queryParsed.data.db)) {
        return;
      }

      const row = db
        .select({ thumbnail: schema.feature.thumbnail })
        .from(schema.feature)
        .where(eq(schema.feature.id, id))
        .get();

      if (!row) {
        return reply.code(404).send({ error: 'Feature not found' });
      }

      const buf = thumbnailToBuffer(row.thumbnail);
      if (!buf || buf.length === 0) {
        return reply.code(404).send({ error: 'Face thumbnail not available' });
      }

      return reply
        .type(CONTENT_TYPE_JPEG)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(buf);
    });

    app.get('/matchingFaces/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid face feature ID' });
      }
      const { id } = paramsParsed.data;

      const queryParsed = matchingFacesQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      const { offset, limit } = queryParsed.data;

      const exists = db
        .select({ id: schema.feature.id })
        .from(schema.feature)
        .where(eq(schema.feature.id, id))
        .get();

      if (!exists) {
        return reply.code(404).send({ error: 'Feature not found' });
      }

      const raw = faceMatcher.getMatchingFaces(id);
      const sorted = [...raw].sort(
        (a, b) => a.mediaItemId - b.mediaItemId || a.featureId - b.featureId,
      );
      const total = sorted.length;
      const items = sorted.slice(offset, offset + limit);

      return reply.send({ items, offset, limit, total });
    });
  },
  { name: 'face-routes', dependencies: ['auth'] },
);
