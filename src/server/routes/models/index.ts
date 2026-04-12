import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../../db/schema.js';
import { MODEL_REGISTRY } from './registry.js';
import {
  checkSecurity,
  hashPasswordField,
  type SecurityContext,
} from '../../../services/security.js';
import {
  NotificationService,
  type NotificationAction,
} from '../../../services/notification.js';

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export interface ModelCrudPluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getIdColumn(table: (typeof MODEL_REGISTRY)[string]): any | undefined {
  return (table as Record<string, unknown>).id;
}

/**
 * Generic CRUD route plugin that auto-registers GET (by id), LIST (with
 * pagination), SAVE (create/update), and DELETE for every model in the
 * registry.
 *
 * Security is enforced via `checkSecurity` as a preHandler-equivalent check
 * inside each handler. The `UserAuthentication` model receives special
 * treatment: password values are hashed before persistence.
 *
 * Notifications are emitted for create, update, and delete operations when
 * a NotificationService is provided.
 */
export const modelCrudPlugin = fp<ModelCrudPluginOptions>(
  async function modelCrudPlugin(
    app: FastifyInstance,
    opts: ModelCrudPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    for (const [modelName, table] of Object.entries(MODEL_REGISTRY)) {
      const idCol = getIdColumn(table);
      if (!idCol) continue;

      registerGetById(app, db, modelName, table, idCol);
      registerList(app, db, modelName, table);
      registerSave(app, db, notifications, modelName, table, idCol);
      registerDelete(app, db, notifications, modelName, table, idCol);
    }
  },
  { name: 'model-crud', dependencies: ['auth'] },
);

function securityContext(db: Db, userId: number): SecurityContext {
  return { userId, db };
}

function emitNotification(
  notifications: NotificationService | undefined,
  action: NotificationAction,
  model: string,
  id: number,
  userId?: number,
): void {
  notifications?.notify(action, model, { id, userId });
}

// ---------------------------------------------------------------------------
// GET /:model/:id
// ---------------------------------------------------------------------------

function registerGetById(
  app: FastifyInstance,
  db: Db,
  modelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idCol: any,
): void {
  app.get(`/${modelName}/:id`, {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid id parameter' });
    }

    const userId = request.userId;
    if (userId === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const result = await checkSecurity(modelName, securityContext(db, userId), 'get');
    if (!result.allowed) {
      return reply.code(403).send({ error: result.reason });
    }

    const row = db.select().from(table).where(eq(idCol, parsed.data.id)).get();
    if (!row) {
      return reply.code(404).send({ error: `${modelName} not found` });
    }

    return reply.send(row);
  });
}

// ---------------------------------------------------------------------------
// GET /:model (list with pagination)
// ---------------------------------------------------------------------------

function registerList(
  app: FastifyInstance,
  db: Db,
  modelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
): void {
  app.get(`/${modelName}`, {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId;
    if (userId === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const result = await checkSecurity(modelName, securityContext(db, userId), 'list');
    if (!result.allowed) {
      return reply.code(403).send({ error: result.reason });
    }

    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) {
      return reply.code(400).send({ error: 'Invalid pagination parameters' });
    }

    const { offset, limit } = pagination.data;

    const rows = db.select().from(table).offset(offset).limit(limit).all();
    const countResult = db.select({ count: sql<number>`count(*)` }).from(table).get();
    const total = Number(countResult?.count ?? 0);

    return reply.send({ items: rows, offset, limit, total });
  });
}

// ---------------------------------------------------------------------------
// POST /:model (create or update)
// ---------------------------------------------------------------------------

function registerSave(
  app: FastifyInstance,
  db: Db,
  notifications: NotificationService | undefined,
  modelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idCol: any,
): void {
  app.post(`/${modelName}`, {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const userId = request.userId;
    if (userId === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    let body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Request body must be a JSON object' });
    }

    const isUpdate = body.id !== undefined && body.id !== null;

    const secResult = await checkSecurity(
      modelName,
      securityContext(db, userId),
      'save',
      body,
    );
    if (!secResult.allowed) {
      return reply.code(403).send({ error: secResult.reason });
    }

    if (modelName === 'userAuthentication') {
      body = await hashPasswordField(body as { key?: string; value?: string });
    }

    if (isUpdate) {
      const recordId = Number(body.id);
      const { id: _id, ...updates } = body;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      db.update(table).set(updates).where(eq(idCol, recordId)).run();

      const updated = db.select().from(table).where(eq(idCol, recordId)).get();
      if (!updated) {
        return reply.code(404).send({ error: `${modelName} not found` });
      }

      emitNotification(notifications, 'update', modelName, recordId, userId);
      return reply.send(updated);
    }

    const inserted = db.insert(table).values(body).returning().get();
    const newId = (inserted as Record<string, unknown>).id as number;
    emitNotification(notifications, 'create', modelName, newId, userId);
    return reply.send(inserted);
  });
}

// ---------------------------------------------------------------------------
// DELETE /:model/:id
// ---------------------------------------------------------------------------

function registerDelete(
  app: FastifyInstance,
  db: Db,
  notifications: NotificationService | undefined,
  modelName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idCol: any,
): void {
  app.delete(`/${modelName}/:id`, {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid id parameter' });
    }

    const userId = request.userId;
    if (userId === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const existing = db.select().from(table).where(eq(idCol, parsed.data.id)).get();
    if (!existing) {
      return reply.code(404).send({ error: `${modelName} not found` });
    }

    const secResult = await checkSecurity(
      modelName,
      securityContext(db, userId),
      'delete',
      existing as Record<string, unknown>,
    );
    if (!secResult.allowed) {
      return reply.code(403).send({ error: secResult.reason });
    }

    db.delete(table).where(eq(idCol, parsed.data.id)).run();

    emitNotification(notifications, 'delete', modelName, parsed.data.id, userId);
    return reply.send({ success: true });
  });
}
