import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import type { NotificationService } from '../../services/notification.js';

const mediaItemIdParams = z.object({
  mediaItemId: z.coerce.number().int().positive(),
});

const ratingBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export interface RatingPluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Rating routes for media items.
 *
 * - `GET /mediaItem/:mediaItemId/ratings` — list all ratings for a media item
 * - `POST /mediaItem/:mediaItemId/rating` — upsert the current user's rating
 * - `DELETE /mediaItem/:mediaItemId/rating` — remove the current user's rating
 *
 * Basic CRUD on the `userRating` table (by id) is handled by the generic model
 * routes. These routes provide the per-user, per-item upsert semantics.
 */
export const ratingPlugin = fp<RatingPluginOptions>(
  async function ratingPlugin(
    app: FastifyInstance,
    opts: RatingPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    // -----------------------------------------------------------------------
    // GET /mediaItem/:mediaItemId/ratings — list ratings for a media item
    // -----------------------------------------------------------------------

    app.get('/mediaItem/:mediaItemId/ratings', {
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
        .from(schema.userRating)
        .where(eq(schema.userRating.itemId, mediaItemId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.userRating)
        .where(eq(schema.userRating.itemId, mediaItemId))
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });

    // -----------------------------------------------------------------------
    // POST /mediaItem/:mediaItemId/rating — upsert current user's rating
    // -----------------------------------------------------------------------

    app.post('/mediaItem/:mediaItemId/rating', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const bodyParsed = ratingBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: 'Request body must include "rating" (integer 1–5)' });
      }
      const { rating, comment } = bodyParsed.data;

      const item = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, mediaItemId))
        .get();

      if (!item) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      const now = new Date().toISOString();

      const existing = db
        .select()
        .from(schema.userRating)
        .where(
          and(
            eq(schema.userRating.userId, userId),
            eq(schema.userRating.itemId, mediaItemId),
          ),
        )
        .get();

      if (existing) {
        db.update(schema.userRating)
          .set({ rating, comment: comment ?? null, date: now })
          .where(eq(schema.userRating.id, existing.id))
          .run();

        const updated = db
          .select()
          .from(schema.userRating)
          .where(eq(schema.userRating.id, existing.id))
          .get();

        notifications?.notify('update', 'userRating', { id: existing.id, userId });

        return reply.send(updated);
      }

      const inserted = db
        .insert(schema.userRating)
        .values({
          userId,
          itemId: mediaItemId,
          rating,
          comment: comment ?? null,
          date: now,
        })
        .returning()
        .get();

      notifications?.notify('create', 'userRating', { id: inserted.id, userId });

      return reply.send(inserted);
    });

    // -----------------------------------------------------------------------
    // DELETE /mediaItem/:mediaItemId/rating — remove current user's rating
    // -----------------------------------------------------------------------

    app.delete('/mediaItem/:mediaItemId/rating', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const existing = db
        .select()
        .from(schema.userRating)
        .where(
          and(
            eq(schema.userRating.userId, userId),
            eq(schema.userRating.itemId, mediaItemId),
          ),
        )
        .get();

      if (!existing) {
        return reply.code(404).send({ error: 'Rating not found' });
      }

      db.delete(schema.userRating)
        .where(eq(schema.userRating.id, existing.id))
        .run();

      notifications?.notify('delete', 'userRating', { id: existing.id, userId });

      return reply.send({ success: true });
    });
  },
  { name: 'rating-routes', dependencies: ['auth'] },
);
