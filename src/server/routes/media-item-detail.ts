import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, or, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';

const mediaItemIdParams = z.object({
  mediaItemId: z.coerce.number().int().positive(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export interface MediaItemDetailPluginOptions {
  db: Database.Database;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Item-scoped detail routes that return features and matches for a specific
 * media item. These complement the generic CRUD routes by providing filtered
 * access without requiring the client to fetch all records.
 *
 * - `GET /mediaItem/:mediaItemId/features` — features (faces) for a media item
 * - `GET /mediaItem/:mediaItemId/matches`  — duplicate/similar matches
 */
export const mediaItemDetailPlugin = fp<MediaItemDetailPluginOptions>(
  async function mediaItemDetailPlugin(
    app: FastifyInstance,
    opts: MediaItemDetailPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });

    // -----------------------------------------------------------------------
    // GET /mediaItem/:mediaItemId/features
    // -----------------------------------------------------------------------

    app.get('/mediaItem/:mediaItemId/features', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const item = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, mediaItemId))
        .get();

      if (!item) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.feature.id,
          itemId: schema.feature.itemId,
          coordinates: schema.feature.coordinates,
          label: schema.feature.label,
          info: schema.feature.info,
        })
        .from(schema.feature)
        .where(eq(schema.feature.itemId, mediaItemId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.feature)
        .where(eq(schema.feature.itemId, mediaItemId))
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });

    // -----------------------------------------------------------------------
    // GET /mediaItem/:mediaItemId/matches
    // -----------------------------------------------------------------------

    app.get('/mediaItem/:mediaItemId/matches', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const item = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, mediaItemId))
        .get();

      if (!item) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = pagination.data;

      const rows = db
        .select()
        .from(schema.mediaMatch)
        .where(
          or(
            eq(schema.mediaMatch.mediaItemId, mediaItemId),
            eq(schema.mediaMatch.matchingItemId, mediaItemId),
          ),
        )
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaMatch)
        .where(
          or(
            eq(schema.mediaMatch.mediaItemId, mediaItemId),
            eq(schema.mediaMatch.matchingItemId, mediaItemId),
          ),
        )
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });
  },
  { name: 'media-item-detail-routes', dependencies: ['auth'] },
);
