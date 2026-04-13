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

const tagBodySchema = z.object({
  word: z.string().min(1).max(255).transform((w) => w.trim().toLowerCase()),
});

const untagBodySchema = z.object({
  keywordId: z.coerce.number().int().positive(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export interface KeywordPluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Find an existing keyword by word, or create one if it doesn't exist.
 * Returns the keyword id.
 */
function findOrCreateKeyword(db: Db, word: string): number {
  const existing = db
    .select({ id: schema.keyword.id })
    .from(schema.keyword)
    .where(eq(schema.keyword.word, word))
    .get();

  if (existing) return existing.id;

  const inserted = db
    .insert(schema.keyword)
    .values({ word })
    .returning({ id: schema.keyword.id })
    .get();

  return inserted.id;
}

/**
 * Keyword tagging routes for media items.
 *
 * - `GET /mediaItem/:mediaItemId/keywords` — list keywords for a media item
 * - `POST /mediaItem/:mediaItemId/keywords` — tag a media item with a keyword (find-or-create by word)
 * - `DELETE /mediaItem/:mediaItemId/keywords` — remove a keyword from a media item
 *
 * Basic keyword CRUD (create/get/list/delete) is handled by the generic model
 * CRUD routes since `keyword` is in the MODEL_REGISTRY.
 */
export const keywordPlugin = fp<KeywordPluginOptions>(
  async function keywordPlugin(
    app: FastifyInstance,
    opts: KeywordPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    // -----------------------------------------------------------------------
    // GET /mediaItem/:mediaItemId/keywords — list keywords for a media item
    // -----------------------------------------------------------------------

    app.get('/mediaItem/:mediaItemId/keywords', {
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
          id: schema.keyword.id,
          word: schema.keyword.word,
        })
        .from(schema.mediaItemKeyword)
        .innerJoin(schema.keyword, eq(schema.keyword.id, schema.mediaItemKeyword.keywordId))
        .where(eq(schema.mediaItemKeyword.mediaItemId, mediaItemId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaItemKeyword)
        .where(eq(schema.mediaItemKeyword.mediaItemId, mediaItemId))
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });

    // -----------------------------------------------------------------------
    // POST /mediaItem/:mediaItemId/keywords — tag a media item with a keyword
    // -----------------------------------------------------------------------

    app.post('/mediaItem/:mediaItemId/keywords', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const bodyParsed = tagBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: 'Request body must include a non-empty "word" string field' });
      }
      const { word } = bodyParsed.data;

      const item = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, mediaItemId))
        .get();

      if (!item) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      const keywordId = findOrCreateKeyword(db, word);

      const existing = db
        .select()
        .from(schema.mediaItemKeyword)
        .where(
          and(
            eq(schema.mediaItemKeyword.mediaItemId, mediaItemId),
            eq(schema.mediaItemKeyword.keywordId, keywordId),
          ),
        )
        .get();

      if (existing) {
        return reply.send({ id: keywordId, word, alreadyTagged: true });
      }

      db.insert(schema.mediaItemKeyword)
        .values({ mediaItemId, keywordId })
        .run();

      notifications?.notify('update', 'mediaItem', { id: mediaItemId });

      return reply.send({ id: keywordId, word, alreadyTagged: false });
    });

    // -----------------------------------------------------------------------
    // DELETE /mediaItem/:mediaItemId/keywords — remove a keyword tag
    // -----------------------------------------------------------------------

    app.delete('/mediaItem/:mediaItemId/keywords', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = mediaItemIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { mediaItemId } = paramsParsed.data;

      const bodyParsed = untagBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: 'Request body must include a positive "keywordId" number field' });
      }
      const { keywordId } = bodyParsed.data;

      const link = db
        .select()
        .from(schema.mediaItemKeyword)
        .where(
          and(
            eq(schema.mediaItemKeyword.mediaItemId, mediaItemId),
            eq(schema.mediaItemKeyword.keywordId, keywordId),
          ),
        )
        .get();

      if (!link) {
        return reply.code(404).send({ error: 'Keyword is not tagged on this media item' });
      }

      db.delete(schema.mediaItemKeyword)
        .where(
          and(
            eq(schema.mediaItemKeyword.mediaItemId, mediaItemId),
            eq(schema.mediaItemKeyword.keywordId, keywordId),
          ),
        )
        .run();

      notifications?.notify('update', 'mediaItem', { id: mediaItemId });

      return reply.send({ success: true });
    });
  },
  { name: 'keyword-routes', dependencies: ['auth'] },
);
