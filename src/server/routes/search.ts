import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, like, sql, lte, gte, inArray } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';

const searchQuerySchema = z.object({
  q: z.string().optional(),
  keyword: z.string().optional(),
  type: z.enum(['image', 'video']).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const keywordsPaginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(200),
});

export interface SearchPluginOptions {
  db: Database.Database;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Search and keyword browsing routes.
 *
 * - `GET /search` — search media items by name, keyword, type, date range
 * - `GET /keywords` — list all keywords with usage counts
 * - `GET /keywords/:keywordId/items` — media items tagged with a keyword
 */
export const searchPlugin = fp<SearchPluginOptions>(
  async function searchPlugin(
    app: FastifyInstance,
    opts: SearchPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });

    // -----------------------------------------------------------------------
    // GET /search — search media items
    // -----------------------------------------------------------------------

    app.get('/search', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid search parameters' });
      }
      const { q, keyword, type, dateStart, dateEnd, offset, limit } = parsed.data;

      const conditions: ReturnType<typeof eq>[] = [];

      if (q) {
        conditions.push(like(schema.mediaItem.name, `%${q}%`));
      }

      if (type) {
        conditions.push(eq(schema.mediaItem.type, type));
      }

      if (dateStart) {
        conditions.push(gte(schema.mediaItem.startDate, dateStart));
      }

      if (dateEnd) {
        conditions.push(lte(schema.mediaItem.startDate, dateEnd));
      }

      if (keyword) {
        const keywordIds = db
          .select({ id: schema.keyword.id })
          .from(schema.keyword)
          .where(eq(schema.keyword.word, keyword.trim().toLowerCase()))
          .all()
          .map((r) => r.id);

        if (keywordIds.length === 0) {
          return reply.send({ items: [], offset, limit, total: 0 });
        }

        const taggedItemIds = db
          .select({ mediaItemId: schema.mediaItemKeyword.mediaItemId })
          .from(schema.mediaItemKeyword)
          .where(inArray(schema.mediaItemKeyword.keywordId, keywordIds))
          .all()
          .map((r) => r.mediaItemId);

        if (taggedItemIds.length === 0) {
          return reply.send({ items: [], offset, limit, total: 0 });
        }

        conditions.push(inArray(schema.mediaItem.id, taggedItemIds));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select({
          id: schema.mediaItem.id,
          name: schema.mediaItem.name,
          description: schema.mediaItem.description,
          type: schema.mediaItem.type,
          startDate: schema.mediaItem.startDate,
          endDate: schema.mediaItem.endDate,
          info: schema.mediaItem.info,
        })
        .from(schema.mediaItem)
        .where(where)
        .orderBy(schema.mediaItem.startDate)
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaItem)
        .where(where)
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });

    // -----------------------------------------------------------------------
    // GET /keywords — list all keywords with usage counts
    // -----------------------------------------------------------------------

    app.get('/keywords', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const parsed = keywordsPaginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = parsed.data;

      const rows = db
        .select({
          id: schema.keyword.id,
          word: schema.keyword.word,
          count: sql<number>`count(${schema.mediaItemKeyword.keywordId})`,
        })
        .from(schema.keyword)
        .leftJoin(schema.mediaItemKeyword, eq(schema.mediaItemKeyword.keywordId, schema.keyword.id))
        .groupBy(schema.keyword.id, schema.keyword.word)
        .orderBy(schema.keyword.word)
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.keyword)
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ items: rows, offset, limit, total });
    });

    // -----------------------------------------------------------------------
    // GET /keywords/:keywordId/items — media items tagged with a keyword
    // -----------------------------------------------------------------------

    const keywordIdParams = z.object({
      keywordId: z.coerce.number().int().positive(),
    });

    const itemsPaginationSchema = z.object({
      offset: z.coerce.number().int().min(0).optional().default(0),
      limit: z.coerce.number().int().positive().max(1000).optional().default(50),
    });

    app.get('/keywords/:keywordId/items', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = keywordIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid keyword ID' });
      }
      const { keywordId } = paramsParsed.data;

      const kw = db
        .select({ id: schema.keyword.id, word: schema.keyword.word })
        .from(schema.keyword)
        .where(eq(schema.keyword.id, keywordId))
        .get();

      if (!kw) {
        return reply.code(404).send({ error: 'Keyword not found' });
      }

      const pagination = itemsPaginationSchema.safeParse(request.query);
      if (!pagination.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.mediaItem.id,
          name: schema.mediaItem.name,
          description: schema.mediaItem.description,
          type: schema.mediaItem.type,
          startDate: schema.mediaItem.startDate,
          endDate: schema.mediaItem.endDate,
          info: schema.mediaItem.info,
        })
        .from(schema.mediaItemKeyword)
        .innerJoin(schema.mediaItem, eq(schema.mediaItem.id, schema.mediaItemKeyword.mediaItemId))
        .where(eq(schema.mediaItemKeyword.keywordId, keywordId))
        .orderBy(schema.mediaItem.startDate)
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaItemKeyword)
        .where(eq(schema.mediaItemKeyword.keywordId, keywordId))
        .get();
      const total = Number(countResult?.count ?? 0);

      return reply.send({ keyword: kw, items: rows, offset, limit, total });
    });
  },
  { name: 'search-routes', dependencies: ['auth'] },
);
