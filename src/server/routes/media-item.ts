import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export interface MediaItemPluginOptions {
  db: Database.Database;
}

/**
 * Media item detail route.
 *
 * `GET /mediaItem/:id` returns the media item record without any linked file
 * data. Consumers that need file info should query the generic CRUD endpoints
 * for `mediaItemFile` instead.
 */
export const mediaItemPlugin = fp<MediaItemPluginOptions>(
  async function mediaItemPlugin(
    app: FastifyInstance,
    opts: MediaItemPluginOptions,
  ): Promise<void> {
    const db: BetterSQLite3Database<typeof schema> = drizzle(opts.db, { schema });

    app.get('/mediaItem/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid media item ID' });
      }
      const { id } = paramsParsed.data;

      // Explicit column list — excludes relational/joined data (e.g. files)
      const row = db
        .select({
          id: schema.mediaItem.id,
          name: schema.mediaItem.name,
          description: schema.mediaItem.description,
          type: schema.mediaItem.type,
          startDate: schema.mediaItem.startDate,
          endDate: schema.mediaItem.endDate,
          hash: schema.mediaItem.hash,
          info: schema.mediaItem.info,
        })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, id))
        .get();

      if (!row) {
        return reply.code(404).send({ error: 'Media item not found' });
      }

      return reply.send(row);
    });
  },
  { name: 'media-item-routes', dependencies: ['auth'] },
);
