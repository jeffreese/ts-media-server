import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import type { NotificationService } from '../../services/notification.js';

const placeIdParams = z.object({
  placeId: z.coerce.number().int().positive(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const placeNameBodySchema = z.object({
  name: z.string().min(1).max(500),
  preferred: z.boolean().optional().default(false),
  info: z.record(z.string(), z.unknown()).optional(),
});

const placeMediaBodySchema = z.object({
  mediaId: z.number().int().positive(),
  info: z.record(z.string(), z.unknown()).optional(),
});

const addressBodySchema = z.object({
  street: z.string().max(500).optional(),
  city: z.string().max(255).optional(),
  state: z.string().max(255).optional(),
  postalCode: z.string().max(50).optional(),
  searchTerm: z.string().max(500).optional(),
});

const idBodySchema = z.object({
  id: z.coerce.number().int().positive(),
});

export interface PlacesPluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Place routes providing relationship-aware endpoints for managing places,
 * their names, linked media items, and addresses.
 *
 * The `place` table has a SpatiaLite geometry column `location` added via
 * custom migration SQL. Geometry operations use raw SQL via SpatiaLite
 * functions since Drizzle doesn't natively support SpatiaLite types.
 *
 * Basic CRUD on `place`, `placeName`, `placeMedia`, and `address` tables
 * is handled by the generic model CRUD plugin. These routes add sub-resource
 * patterns:
 *
 * Names:
 * - `GET /place/:placeId/names`
 * - `POST /place/:placeId/names`
 * - `DELETE /place/:placeId/names`
 *
 * Media:
 * - `GET /place/:placeId/media`
 * - `POST /place/:placeId/media`
 * - `DELETE /place/:placeId/media`
 *
 * Addresses:
 * - `GET /place/:placeId/addresses`
 * - `POST /place/:placeId/addresses`
 * - `DELETE /place/:placeId/addresses`
 */
export const placesPlugin = fp<PlacesPluginOptions>(
  async function placesPlugin(
    app: FastifyInstance,
    opts: PlacesPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    function assertPlace(placeId: number): boolean {
      return !!db
        .select({ id: schema.place.id })
        .from(schema.place)
        .where(eq(schema.place.id, placeId))
        .get();
    }

    // -----------------------------------------------------------------------
    // Place Names
    // -----------------------------------------------------------------------

    app.get('/place/:placeId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select()
        .from(schema.placeName)
        .where(eq(schema.placeName.placeId, placeId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.placeName)
        .where(eq(schema.placeName.placeId, placeId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/place/:placeId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const body = placeNameBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a non-empty "name" string field' });
      const { name, preferred, info } = body.data;

      if (preferred) {
        db.update(schema.placeName)
          .set({ preferred: false })
          .where(eq(schema.placeName.placeId, placeId))
          .run();
      }

      const inserted = db
        .insert(schema.placeName)
        .values({ placeId, name, preferred, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'place', { id: placeId });
      return reply.send(inserted);
    });

    app.delete('/place/:placeId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.placeName)
        .where(and(eq(schema.placeName.id, body.data.id), eq(schema.placeName.placeId, placeId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Name not found for this place' });

      db.delete(schema.placeName).where(eq(schema.placeName.id, body.data.id)).run();
      notifications?.notify('update', 'place', { id: placeId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // Place-Media linking
    // -----------------------------------------------------------------------

    app.get('/place/:placeId/media', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.placeMedia.id,
          mediaId: schema.placeMedia.mediaId,
          placeId: schema.placeMedia.placeId,
          info: schema.placeMedia.info,
          mediaName: schema.mediaItem.name,
          mediaType: schema.mediaItem.type,
        })
        .from(schema.placeMedia)
        .innerJoin(schema.mediaItem, eq(schema.mediaItem.id, schema.placeMedia.mediaId))
        .where(eq(schema.placeMedia.placeId, placeId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.placeMedia)
        .where(eq(schema.placeMedia.placeId, placeId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/place/:placeId/media', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const body = placeMediaBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "mediaId" field' });
      const { mediaId, info } = body.data;

      const item = db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.id, mediaId))
        .get();

      if (!item) return reply.code(404).send({ error: 'Media item not found' });

      const existing = db
        .select()
        .from(schema.placeMedia)
        .where(and(
          eq(schema.placeMedia.placeId, placeId),
          eq(schema.placeMedia.mediaId, mediaId),
        ))
        .get();

      if (existing) return reply.send({ ...existing, alreadyLinked: true });

      const inserted = db
        .insert(schema.placeMedia)
        .values({ placeId, mediaId, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'place', { id: placeId });
      return reply.send(inserted);
    });

    app.delete('/place/:placeId/media', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.placeMedia)
        .where(and(eq(schema.placeMedia.id, body.data.id), eq(schema.placeMedia.placeId, placeId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Media link not found for this place' });

      db.delete(schema.placeMedia).where(eq(schema.placeMedia.id, body.data.id)).run();
      notifications?.notify('update', 'place', { id: placeId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // Place Addresses
    // -----------------------------------------------------------------------

    app.get('/place/:placeId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select()
        .from(schema.address)
        .where(eq(schema.address.placeId, placeId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.address)
        .where(eq(schema.address.placeId, placeId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/place/:placeId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      if (!assertPlace(placeId)) return reply.code(404).send({ error: 'Place not found' });

      const body = addressBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid address fields' });

      const inserted = db
        .insert(schema.address)
        .values({
          placeId,
          street: body.data.street ?? null,
          city: body.data.city ?? null,
          state: body.data.state ?? null,
          postalCode: body.data.postalCode ?? null,
          searchTerm: body.data.searchTerm ?? null,
        })
        .returning()
        .get();

      notifications?.notify('update', 'place', { id: placeId });
      return reply.send(inserted);
    });

    app.delete('/place/:placeId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = placeIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid place ID' });
      const { placeId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.address)
        .where(and(eq(schema.address.id, body.data.id), eq(schema.address.placeId, placeId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Address not found for this place' });

      db.delete(schema.address).where(eq(schema.address.id, body.data.id)).run();
      notifications?.notify('update', 'place', { id: placeId });
      return reply.send({ success: true });
    });
  },
  { name: 'places-routes', dependencies: ['auth'] },
);
