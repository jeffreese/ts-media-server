import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(10000).optional().default(5000),
});

export interface MapPluginOptions {
  db: Database.Database;
}

/**
 * Map-related routes for querying GPS-tagged media items.
 *
 * GPS coordinates are stored in the media_item `info` JSON field under
 * `gps.latitude` and `gps.longitude` (added during indexing when EXIF
 * GPS data is present).
 *
 * `GET /map/media` — returns all GPS-tagged media items with coordinates,
 * optimized for map marker rendering (returns id, name, type, lat, lng).
 */
export const mapPlugin = fp<MapPluginOptions>(
  async function mapPlugin(
    app: FastifyInstance,
    opts: MapPluginOptions,
  ): Promise<void> {
    const db: BetterSQLite3Database<typeof schema> = drizzle(opts.db, { schema });

    app.get('/map/media', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.mediaItem.id,
          name: schema.mediaItem.name,
          type: schema.mediaItem.type,
          latitude: sql<number>`json_extract(${schema.mediaItem.info}, '$.gps.latitude')`,
          longitude: sql<number>`json_extract(${schema.mediaItem.info}, '$.gps.longitude')`,
        })
        .from(schema.mediaItem)
        .where(sql`json_extract(${schema.mediaItem.info}, '$.gps.latitude') IS NOT NULL`)
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaItem)
        .where(sql`json_extract(${schema.mediaItem.info}, '$.gps.latitude') IS NOT NULL`)
        .get();

      return reply.send({
        items: rows,
        offset,
        limit,
        total: Number(countResult?.count ?? 0),
      });
    });
  },
  { name: 'map-routes', dependencies: ['auth'] },
);
