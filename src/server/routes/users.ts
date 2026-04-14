import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, sql, desc } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { USERADMIN_KEY, SYSADMIN_KEY, ADMIN_ACCESS_LEVEL } from '../../db/constants.js';
import { getAccessLevel, getAdminCount } from '../../services/security.js';

type Db = BetterSQLite3Database<typeof schema>;

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const userCreateSchema = z.object({
  name: z.string().min(1),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  status: z.string().optional(),
});

const userUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  status: z.string().optional(),
});

const preferenceUpsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

const groupMembershipSchema = z.object({
  userId: z.number().int().positive(),
  isAdmin: z.boolean().optional().default(false),
});

export interface UserRoutesPluginOptions {
  db: Database.Database;
}

// ---------------------------------------------------------------------------
// Activity tracking — in-memory counters flushed to DB on interval
// ---------------------------------------------------------------------------

interface ActivityKey {
  userId: number;
  hour: number;
  minute: number;
}

function activityKeyString(k: ActivityKey): string {
  return `${k.userId}:${k.hour}:${k.minute}`;
}

class ActivityTracker {
  private counters = new Map<string, ActivityKey & { count: number }>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private db: Db;

  static readonly FLUSH_INTERVAL_MS = 2 * 60 * 1000;

  constructor(db: Db) {
    this.db = db;
  }

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), ActivityTracker.FLUSH_INTERVAL_MS);
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
  }

  increment(userId: number): void {
    const now = new Date();
    const key: ActivityKey = {
      userId,
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
    };
    const keyStr = activityKeyString(key);
    const existing = this.counters.get(keyStr);
    if (existing) {
      existing.count++;
    } else {
      this.counters.set(keyStr, { ...key, count: 1 });
    }
  }

  flush(): void {
    if (this.counters.size === 0) return;

    const entries = [...this.counters.values()];
    this.counters.clear();

    for (const entry of entries) {
      const existing = this.db
        .select()
        .from(schema.userActivity)
        .where(
          and(
            eq(schema.userActivity.userId, entry.userId),
            eq(schema.userActivity.hour, entry.hour),
            eq(schema.userActivity.minute, entry.minute),
          ),
        )
        .get();

      if (existing) {
        this.db
          .update(schema.userActivity)
          .set({ count: existing.count + entry.count })
          .where(eq(schema.userActivity.id, existing.id))
          .run();
      } else {
        this.db
          .insert(schema.userActivity)
          .values({
            userId: entry.userId,
            hour: entry.hour,
            minute: entry.minute,
            count: entry.count,
          })
          .run();
      }
    }
  }

  /** Visible for testing. */
  get pendingCount(): number {
    return this.counters.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUserAdmin(db: Db, userId: number): boolean {
  return getAccessLevel(db, userId, USERADMIN_KEY) >= ADMIN_ACCESS_LEVEL;
}

function getPreferredName(db: Db, personId: number): string | undefined {
  const row = db
    .select({ name: schema.personName.name })
    .from(schema.personName)
    .where(
      and(
        eq(schema.personName.personId, personId),
        eq(schema.personName.preferred, true),
      ),
    )
    .get();
  return row?.name;
}

function getLastAccess(db: Db, userId: number): string | null {
  const row = db
    .select({ hour: schema.userActivity.hour, minute: schema.userActivity.minute })
    .from(schema.userActivity)
    .where(eq(schema.userActivity.userId, userId))
    .orderBy(desc(schema.userActivity.hour), desc(schema.userActivity.minute))
    .limit(1)
    .get();

  if (!row) return null;
  return `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * User management routes:
 *
 * - `GET /users/:id` — get user with person info and last access
 * - `GET /users` — list users with person info and last access
 * - `POST /users` — create user with linked person record (UserAdmin)
 * - `POST /users/:id` — update user and linked person/name (UserAdmin or self)
 * - `DELETE /users/:id` — delete user (UserAdmin)
 * - `POST /users/:id/preferences` — upsert a preference for the user
 * - `GET /users/:id/preferences` — list preferences for the user
 * - `POST /userGroup/:id/members` — add member to group (UserAdmin)
 * - `DELETE /userGroup/:id/members/:userId` — remove member from group (UserAdmin)
 * - `GET /userGroup/:id/members` — list group members
 */
export const userRoutesPlugin = fp<UserRoutesPluginOptions>(
  async function userRoutesPlugin(
    app: FastifyInstance,
    opts: UserRoutesPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const tracker = new ActivityTracker(db);
    tracker.start();

    app.addHook('onClose', () => {
      tracker.stop();
    });

    app.addHook('onRequest', (request, _reply, done) => {
      if (request.userId !== undefined) {
        tracker.increment(request.userId);
      }
      done();
    });

    // -----------------------------------------------------------------
    // GET /users/:id
    // -----------------------------------------------------------------

    app.get('/users/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const parsed = idParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }

      const user = db.select().from(schema.user).where(eq(schema.user.id, parsed.data.id)).get();
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const name = user.personId ? getPreferredName(db, user.personId) : undefined;
      const lastAccess = getLastAccess(db, user.id);

      return reply.send({ ...user, name, lastAccess });
    });

    // -----------------------------------------------------------------
    // GET /users
    // -----------------------------------------------------------------

    const paginationSchema = z.object({
      offset: z.coerce.number().int().min(0).optional().default(0),
      limit: z.coerce.number().int().positive().max(1000).optional().default(50),
    });

    app.get('/users', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const pagination = paginationSchema.safeParse(request.query);
      if (!pagination.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }

      const { offset, limit } = pagination.data;

      const users = db.select().from(schema.user).offset(offset).limit(limit).all();
      const countResult = db.select({ count: sql<number>`count(*)` }).from(schema.user).get();
      const total = Number(countResult?.count ?? 0);

      const items = users.map((u) => {
        const name = u.personId ? getPreferredName(db, u.personId) : undefined;
        const lastAccess = getLastAccess(db, u.id);
        return { ...u, name, lastAccess };
      });

      return reply.send({ items, offset, limit, total });
    });

    // -----------------------------------------------------------------
    // POST /users (create)
    // -----------------------------------------------------------------

    app.post('/users', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required' });
      }

      const parsed = userCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }

      const { name, gender, birthday, status } = parsed.data;

      const person = db
        .insert(schema.person)
        .values({ gender, birthday })
        .returning()
        .get();

      db.insert(schema.personName)
        .values({ personId: person.id, name, preferred: true })
        .run();

      const user = db
        .insert(schema.user)
        .values({ personId: person.id, status: status ?? 'active' })
        .returning()
        .get();

      return reply.send({ ...user, name });
    });

    // -----------------------------------------------------------------
    // POST /users/:id (update)
    // -----------------------------------------------------------------

    app.post('/users/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const targetId = paramsParsed.data.id;

      const isSelf = targetId === userId;
      if (!isSelf && !requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required to modify other users' });
      }

      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({ error: 'Request body must be a JSON object' });
      }

      const parsed = userUpdateSchema.safeParse({ ...body, id: targetId });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }

      const existing = db.select().from(schema.user).where(eq(schema.user.id, targetId)).get();
      if (!existing) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const { name, gender, birthday, status } = parsed.data;

      if (status !== undefined) {
        db.update(schema.user).set({ status }).where(eq(schema.user.id, targetId)).run();
      }

      if (existing.personId && (gender !== undefined || birthday !== undefined)) {
        const personUpdates: Record<string, unknown> = {};
        if (gender !== undefined) personUpdates.gender = gender;
        if (birthday !== undefined) personUpdates.birthday = birthday;
        if (Object.keys(personUpdates).length > 0) {
          db.update(schema.person).set(personUpdates).where(eq(schema.person.id, existing.personId)).run();
        }
      }

      if (name !== undefined && existing.personId) {
        const existingName = db
          .select()
          .from(schema.personName)
          .where(
            and(
              eq(schema.personName.personId, existing.personId),
              eq(schema.personName.preferred, true),
            ),
          )
          .get();

        if (existingName) {
          db.update(schema.personName)
            .set({ name })
            .where(eq(schema.personName.id, existingName.id))
            .run();
        } else {
          db.insert(schema.personName)
            .values({ personId: existing.personId, name, preferred: true })
            .run();
        }
      }

      const updated = db.select().from(schema.user).where(eq(schema.user.id, targetId)).get()!;
      const updatedName = updated.personId ? getPreferredName(db, updated.personId) : undefined;

      return reply.send({ ...updated, name: updatedName });
    });

    // -----------------------------------------------------------------
    // DELETE /users/:id
    // -----------------------------------------------------------------

    app.delete('/users/:id', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required' });
      }

      const parsed = idParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }

      const user = db.select().from(schema.user).where(eq(schema.user.id, parsed.data.id)).get();
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const remainingAdmins = getAdminCount(db, SYSADMIN_KEY, parsed.data.id);
      if (remainingAdmins === 0) {
        return reply.code(403).send({ error: 'Cannot delete the last admin user' });
      }

      db.delete(schema.user).where(eq(schema.user.id, parsed.data.id)).run();

      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------
    // POST /users/:id/preferences (upsert)
    // -----------------------------------------------------------------

    app.post('/users/:id/preferences', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const targetUserId = paramsParsed.data.id;

      if (targetUserId !== userId) {
        return reply.code(403).send({ error: 'Users can only manage their own preferences' });
      }

      const parsed = preferenceUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }

      const { key, value } = parsed.data;

      const existing = db
        .select()
        .from(schema.userPreference)
        .where(
          and(
            eq(schema.userPreference.userId, targetUserId),
            eq(schema.userPreference.key, key),
          ),
        )
        .get();

      if (existing) {
        db.update(schema.userPreference)
          .set({ value })
          .where(eq(schema.userPreference.id, existing.id))
          .run();

        const updated = db.select().from(schema.userPreference).where(eq(schema.userPreference.id, existing.id)).get();
        return reply.send(updated);
      }

      const inserted = db
        .insert(schema.userPreference)
        .values({ userId: targetUserId, key, value })
        .returning()
        .get();

      return reply.send(inserted);
    });

    // -----------------------------------------------------------------
    // GET /users/:id/preferences
    // -----------------------------------------------------------------

    app.get('/users/:id/preferences', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const targetUserId = paramsParsed.data.id;

      if (targetUserId !== userId) {
        return reply.code(403).send({ error: 'Users can only view their own preferences' });
      }

      const prefs = db
        .select()
        .from(schema.userPreference)
        .where(eq(schema.userPreference.userId, targetUserId))
        .all();

      return reply.send(prefs);
    });

    // -----------------------------------------------------------------
    // GET /users/:id/activity
    // -----------------------------------------------------------------

    app.get('/users/:id/activity', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const targetUserId = paramsParsed.data.id;

      if (targetUserId !== userId && !requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required to view other users\' activity' });
      }

      const user = db.select().from(schema.user).where(eq(schema.user.id, targetUserId)).get();
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const rows = db
        .select()
        .from(schema.userActivity)
        .where(eq(schema.userActivity.userId, targetUserId))
        .orderBy(schema.userActivity.hour, schema.userActivity.minute)
        .all();

      return reply.send(rows);
    });

    // -----------------------------------------------------------------
    // POST /userGroup/:id/members
    // -----------------------------------------------------------------

    app.post('/userGroup/:id/members', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required' });
      }

      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const groupId = paramsParsed.data.id;

      const group = db.select().from(schema.userGroup).where(eq(schema.userGroup.id, groupId)).get();
      if (!group) {
        return reply.code(404).send({ error: 'User group not found' });
      }

      const parsed = groupMembershipSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }

      const { userId: memberUserId, isAdmin } = parsed.data;

      const user = db.select().from(schema.user).where(eq(schema.user.id, memberUserId)).get();
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const existing = db
        .select()
        .from(schema.userGroupUser)
        .where(
          and(
            eq(schema.userGroupUser.userGroupId, groupId),
            eq(schema.userGroupUser.userId, memberUserId),
          ),
        )
        .get();

      if (existing) {
        db.update(schema.userGroupUser)
          .set({ isAdmin })
          .where(
            and(
              eq(schema.userGroupUser.userGroupId, groupId),
              eq(schema.userGroupUser.userId, memberUserId),
            ),
          )
          .run();
      } else {
        db.insert(schema.userGroupUser)
          .values({ userGroupId: groupId, userId: memberUserId, isAdmin })
          .run();
      }

      const membership = db
        .select()
        .from(schema.userGroupUser)
        .where(
          and(
            eq(schema.userGroupUser.userGroupId, groupId),
            eq(schema.userGroupUser.userId, memberUserId),
          ),
        )
        .get();

      return reply.send(membership);
    });

    // -----------------------------------------------------------------
    // DELETE /userGroup/:id/members/:userId
    // -----------------------------------------------------------------

    const memberParamsSchema = z.object({
      id: z.coerce.number().int().positive(),
      userId: z.coerce.number().int().positive(),
    });

    app.delete('/userGroup/:id/members/:userId', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!requireUserAdmin(db, userId)) {
        return reply.code(403).send({ error: 'UserAdmin access required' });
      }

      const parsed = memberParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid parameters' });
      }

      const { id: groupId, userId: memberUserId } = parsed.data;

      const existing = db
        .select()
        .from(schema.userGroupUser)
        .where(
          and(
            eq(schema.userGroupUser.userGroupId, groupId),
            eq(schema.userGroupUser.userId, memberUserId),
          ),
        )
        .get();

      if (!existing) {
        return reply.code(404).send({ error: 'Membership not found' });
      }

      db.delete(schema.userGroupUser)
        .where(
          and(
            eq(schema.userGroupUser.userGroupId, groupId),
            eq(schema.userGroupUser.userId, memberUserId),
          ),
        )
        .run();

      return reply.send({ success: true });
    });

    // -----------------------------------------------------------------
    // GET /userGroup/:id/members
    // -----------------------------------------------------------------

    app.get('/userGroup/:id/members', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = idParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid id parameter' });
      }
      const groupId = paramsParsed.data.id;

      const group = db.select().from(schema.userGroup).where(eq(schema.userGroup.id, groupId)).get();
      if (!group) {
        return reply.code(404).send({ error: 'User group not found' });
      }

      const members = db
        .select({
          userId: schema.userGroupUser.userId,
          isAdmin: schema.userGroupUser.isAdmin,
          userGroupId: schema.userGroupUser.userGroupId,
        })
        .from(schema.userGroupUser)
        .where(eq(schema.userGroupUser.userGroupId, groupId))
        .all();

      return reply.send(members);
    });
  },
  { name: 'user-routes', dependencies: ['auth'] },
);

export { ActivityTracker };
