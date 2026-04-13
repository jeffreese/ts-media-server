import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import type { NotificationService } from '../../services/notification.js';

const personIdParams = z.object({
  personId: z.coerce.number().int().positive(),
});

const featureIdParams = z.object({
  featureId: z.coerce.number().int().positive(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const nameBodySchema = z.object({
  name: z.string().min(1).max(500),
  preferred: z.boolean().optional().default(false),
  info: z.record(z.string(), z.unknown()).optional(),
});

const contactBodySchema = z.object({
  contact: z.string().min(1).max(500),
  type: z.string().max(100).optional(),
  info: z.record(z.string(), z.unknown()).optional(),
});

const addressLinkBodySchema = z.object({
  addressId: z.number().int().positive(),
  type: z.string().max(100).optional(),
  preferred: z.boolean().optional().default(false),
  info: z.record(z.string(), z.unknown()).optional(),
});

const personFeatureBodySchema = z.object({
  featureId: z.number().int().positive(),
  info: z.record(z.string(), z.unknown()).optional(),
});

const idBodySchema = z.object({
  id: z.coerce.number().int().positive(),
});

export interface PeoplePluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

/**
 * People routes providing relationship-aware endpoints for managing persons
 * and their linked names, contacts, addresses, and face features.
 *
 * Basic CRUD on `person`, `personName`, `personAddress`, `personContact`,
 * and `personFeature` tables is handled by the generic model CRUD plugin.
 * These routes add sub-resource patterns:
 *
 * Names:
 * - `GET /person/:personId/names`
 * - `POST /person/:personId/names`
 * - `DELETE /person/:personId/names`
 *
 * Contacts:
 * - `GET /person/:personId/contacts`
 * - `POST /person/:personId/contacts`
 * - `DELETE /person/:personId/contacts`
 *
 * Addresses:
 * - `GET /person/:personId/addresses`
 * - `POST /person/:personId/addresses`
 * - `DELETE /person/:personId/addresses`
 *
 * Features (face linking):
 * - `GET /person/:personId/features`
 * - `POST /person/:personId/features`
 * - `DELETE /person/:personId/features`
 * - `GET /feature/:featureId/person`
 */
export const peoplePlugin = fp<PeoplePluginOptions>(
  async function peoplePlugin(
    app: FastifyInstance,
    opts: PeoplePluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    function assertPerson(personId: number): boolean {
      return !!db
        .select({ id: schema.person.id })
        .from(schema.person)
        .where(eq(schema.person.id, personId))
        .get();
    }

    // -----------------------------------------------------------------------
    // Names
    // -----------------------------------------------------------------------

    app.get('/person/:personId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select()
        .from(schema.personName)
        .where(eq(schema.personName.personId, personId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.personName)
        .where(eq(schema.personName.personId, personId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/person/:personId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const body = nameBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a non-empty "name" string field' });
      const { name, preferred, info } = body.data;

      if (preferred) {
        db.update(schema.personName)
          .set({ preferred: false })
          .where(eq(schema.personName.personId, personId))
          .run();
      }

      const inserted = db
        .insert(schema.personName)
        .values({ personId, name, preferred, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'person', { id: personId });
      return reply.send(inserted);
    });

    app.delete('/person/:personId/names', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.personName)
        .where(and(eq(schema.personName.id, body.data.id), eq(schema.personName.personId, personId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Name not found for this person' });

      db.delete(schema.personName).where(eq(schema.personName.id, body.data.id)).run();
      notifications?.notify('update', 'person', { id: personId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // Contacts
    // -----------------------------------------------------------------------

    app.get('/person/:personId/contacts', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select()
        .from(schema.personContact)
        .where(eq(schema.personContact.personId, personId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.personContact)
        .where(eq(schema.personContact.personId, personId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/person/:personId/contacts', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const body = contactBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a non-empty "contact" string field' });
      const { contact, type, info } = body.data;

      const inserted = db
        .insert(schema.personContact)
        .values({ personId, contact, type: type ?? null, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'person', { id: personId });
      return reply.send(inserted);
    });

    app.delete('/person/:personId/contacts', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.personContact)
        .where(and(eq(schema.personContact.id, body.data.id), eq(schema.personContact.personId, personId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Contact not found for this person' });

      db.delete(schema.personContact).where(eq(schema.personContact.id, body.data.id)).run();
      notifications?.notify('update', 'person', { id: personId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // Addresses (link person to existing address records)
    // -----------------------------------------------------------------------

    app.get('/person/:personId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.personAddress.id,
          addressId: schema.personAddress.addressId,
          personId: schema.personAddress.personId,
          type: schema.personAddress.type,
          preferred: schema.personAddress.preferred,
          info: schema.personAddress.info,
          street: schema.address.street,
          city: schema.address.city,
          state: schema.address.state,
          postalCode: schema.address.postalCode,
        })
        .from(schema.personAddress)
        .innerJoin(schema.address, eq(schema.address.id, schema.personAddress.addressId))
        .where(eq(schema.personAddress.personId, personId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.personAddress)
        .where(eq(schema.personAddress.personId, personId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/person/:personId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const body = addressLinkBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "addressId" field' });
      const { addressId, type, preferred, info } = body.data;

      const addr = db
        .select({ id: schema.address.id })
        .from(schema.address)
        .where(eq(schema.address.id, addressId))
        .get();

      if (!addr) return reply.code(404).send({ error: 'Address not found' });

      const existing = db
        .select()
        .from(schema.personAddress)
        .where(and(
          eq(schema.personAddress.personId, personId),
          eq(schema.personAddress.addressId, addressId),
        ))
        .get();

      if (existing) return reply.send({ ...existing, alreadyLinked: true });

      if (preferred) {
        db.update(schema.personAddress)
          .set({ preferred: false })
          .where(eq(schema.personAddress.personId, personId))
          .run();
      }

      const inserted = db
        .insert(schema.personAddress)
        .values({ personId, addressId, type: type ?? null, preferred, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'person', { id: personId });
      return reply.send(inserted);
    });

    app.delete('/person/:personId/addresses', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.personAddress)
        .where(and(eq(schema.personAddress.id, body.data.id), eq(schema.personAddress.personId, personId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Address link not found for this person' });

      db.delete(schema.personAddress).where(eq(schema.personAddress.id, body.data.id)).run();
      notifications?.notify('update', 'person', { id: personId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // Features (face → person linking)
    // -----------------------------------------------------------------------

    app.get('/person/:personId/features', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) return reply.code(400).send({ error: 'Invalid pagination parameters' });
      const { offset, limit } = pagination.data;

      const rows = db
        .select({
          id: schema.personFeature.id,
          featureId: schema.personFeature.featureId,
          personId: schema.personFeature.personId,
          info: schema.personFeature.info,
          itemId: schema.feature.itemId,
          label: schema.feature.label,
        })
        .from(schema.personFeature)
        .innerJoin(schema.feature, eq(schema.feature.id, schema.personFeature.featureId))
        .where(eq(schema.personFeature.personId, personId))
        .offset(offset)
        .limit(limit)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.personFeature)
        .where(eq(schema.personFeature.personId, personId))
        .get();

      return reply.send({ items: rows, offset, limit, total: Number(countResult?.count ?? 0) });
    });

    app.post('/person/:personId/features', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      if (!assertPerson(personId)) return reply.code(404).send({ error: 'Person not found' });

      const body = personFeatureBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "featureId" field' });
      const { featureId, info } = body.data;

      const feat = db
        .select({ id: schema.feature.id })
        .from(schema.feature)
        .where(eq(schema.feature.id, featureId))
        .get();

      if (!feat) return reply.code(404).send({ error: 'Feature not found' });

      const existing = db
        .select()
        .from(schema.personFeature)
        .where(and(
          eq(schema.personFeature.personId, personId),
          eq(schema.personFeature.featureId, featureId),
        ))
        .get();

      if (existing) return reply.send({ ...existing, alreadyLinked: true });

      const inserted = db
        .insert(schema.personFeature)
        .values({ personId, featureId, info: info ?? null })
        .returning()
        .get();

      notifications?.notify('update', 'person', { id: personId });
      return reply.send(inserted);
    });

    app.delete('/person/:personId/features', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = personIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid person ID' });
      const { personId } = params.data;

      const body = idBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'Request body must include a positive "id" field' });

      const existing = db
        .select()
        .from(schema.personFeature)
        .where(and(eq(schema.personFeature.id, body.data.id), eq(schema.personFeature.personId, personId)))
        .get();

      if (!existing) return reply.code(404).send({ error: 'Feature link not found for this person' });

      db.delete(schema.personFeature).where(eq(schema.personFeature.id, body.data.id)).run();
      notifications?.notify('update', 'person', { id: personId });
      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------------
    // GET /feature/:featureId/person — look up which person a face belongs to
    // -----------------------------------------------------------------------

    app.get('/feature/:featureId/person', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const params = featureIdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid feature ID' });
      const { featureId } = params.data;

      const link = db
        .select({
          personFeatureId: schema.personFeature.id,
          personId: schema.personFeature.personId,
          featureId: schema.personFeature.featureId,
          info: schema.personFeature.info,
        })
        .from(schema.personFeature)
        .where(eq(schema.personFeature.featureId, featureId))
        .get();

      if (!link) return reply.code(404).send({ error: 'No person linked to this feature' });

      const personRow = db
        .select()
        .from(schema.person)
        .where(eq(schema.person.id, link.personId))
        .get();

      const names = db
        .select()
        .from(schema.personName)
        .where(eq(schema.personName.personId, link.personId))
        .all();

      return reply.send({ person: personRow, names, link });
    });
  },
  { name: 'people-routes', dependencies: ['auth'] },
);
