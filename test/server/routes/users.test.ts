import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import * as schema from '../../../src/db/schema.js';
import type { Config } from '../../../src/config/schema.js';
import { ActivityTracker } from '../../../src/server/routes/users.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    jwt: { secret: 'test-secret', expiresIn: '1h' },
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

describe('user management routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  function enableAuth(client: DatabaseClient): void {
    const db = drizzle(client.db, { schema });
    db.update(schema.setting)
      .set({ value: 'enabled' })
      .where(eq(schema.setting.key, 'auth_status'))
      .run();
  }

  function getAdminToken(): string {
    return app.server.jwt.sign({ userId: 1 });
  }

  function createNonAdminUser(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const person = db.insert(schema.person).values({}).returning().get();
    db.insert(schema.personName)
      .values({ personId: person.id, name: 'Regular User', preferred: true })
      .run();
    const user = db.insert(schema.user)
      .values({ personId: person.id, status: 'active' })
      .returning()
      .get();
    return user.id;
  }

  async function setupApp(client: DatabaseClient): Promise<void> {
    app = await createApp({
      config: makeConfig(),
      db: client.db,
      loggerOptions,
    });
    await app.server.ready();
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // User CRUD with person linkage
  // ---------------------------------------------------------------------------

  describe('user CRUD', () => {
    it('creates a user with linked person and name', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/users',
        payload: { name: 'Jane Doe', gender: 'female', birthday: '1990-05-15' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Jane Doe');
      expect(body.status).toBe('active');
      expect(body.personId).toBeDefined();

      const db = drizzle(client.db, { schema });
      const person = db.select().from(schema.person).where(eq(schema.person.id, body.personId)).get();
      expect(person).toBeDefined();
      expect(person!.gender).toBe('female');
      expect(person!.birthday).toBe('1990-05-15');

      const personName = db.select().from(schema.personName)
        .where(and(eq(schema.personName.personId, body.personId), eq(schema.personName.preferred, true)))
        .get();
      expect(personName).toBeDefined();
      expect(personName!.name).toBe('Jane Doe');
    });

    it('requires UserAdmin to create users', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/users',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Blocked User' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('UserAdmin');
    });

    it('gets a user by id with name and lastAccess', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/users/1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(1);
      expect(body.name).toBe('Admin');
      expect(body).toHaveProperty('lastAccess');
    });

    it('returns 404 for non-existent user', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/users/9999',
      });

      expect(response.statusCode).toBe(404);
    });

    it('lists users with pagination', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/users',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.items[0]).toHaveProperty('name');
    });

    it('updates a user and linked person info', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/users',
        payload: { name: 'Original Name' },
      });
      const created = createRes.json();

      const updateRes = await app.server.inject({
        method: 'POST',
        url: `/users/${created.id}`,
        payload: { name: 'Updated Name', status: 'inactive', gender: 'male' },
      });

      expect(updateRes.statusCode).toBe(200);
      const updated = updateRes.json();
      expect(updated.name).toBe('Updated Name');
      expect(updated.status).toBe('inactive');

      const db = drizzle(client.db, { schema });
      const person = db.select().from(schema.person).where(eq(schema.person.id, updated.personId)).get();
      expect(person!.gender).toBe('male');
    });

    it('allows self-update without UserAdmin', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: `/users/${nonAdminId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'away' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('away');
    });

    it('requires UserAdmin to update other users', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/users/1',
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'inactive' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('deletes a user', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/users',
        payload: { name: 'To Delete' },
      });
      const created = createRes.json();

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/users/${created.id}`,
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const getRes = await app.server.inject({
        method: 'GET',
        url: `/users/${created.id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('prevents deleting the last admin user', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/users/1',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('last admin');
    });

    it('requires UserAdmin to delete users', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/users/1',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // User preferences
  // ---------------------------------------------------------------------------

  describe('user preferences', () => {
    it('upserts a preference (create)', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        payload: { key: 'theme', value: 'dark' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.key).toBe('theme');
      expect(body.value).toBe('dark');
      expect(body.userId).toBe(1);
    });

    it('upserts a preference (update existing)', async () => {
      const client = setupDb();
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        payload: { key: 'theme', value: 'dark' },
      });

      const response = await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        payload: { key: 'theme', value: 'light' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().value).toBe('light');

      const db = drizzle(client.db, { schema });
      const prefs = db.select().from(schema.userPreference)
        .where(and(eq(schema.userPreference.userId, 1), eq(schema.userPreference.key, 'theme')))
        .all();
      expect(prefs.length).toBe(1);
    });

    it('lists preferences for a user', async () => {
      const client = setupDb();
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        payload: { key: 'theme', value: 'dark' },
      });
      await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        payload: { key: 'language', value: 'en' },
      });

      const response = await app.server.inject({
        method: 'GET',
        url: '/users/1/preferences',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.length).toBe(2);
    });

    it('prevents accessing other users preferences', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/users/1/preferences',
        headers: { authorization: `Bearer ${token}` },
        payload: { key: 'theme', value: 'dark' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('prevents viewing other users preferences', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'GET',
        url: '/users/1/preferences',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // User group membership
  // ---------------------------------------------------------------------------

  describe('user group membership', () => {
    async function createGroup(): Promise<number> {
      const response = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Test Group' },
      });
      return response.json().id;
    }

    it('adds a member to a group', async () => {
      const client = setupDb();
      await setupApp(client);

      const groupId = await createGroup();

      const response = await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        payload: { userId: 1, isAdmin: false },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.userId).toBe(1);
      expect(body.userGroupId).toBe(groupId);
      expect(body.isAdmin).toBe(false);
    });

    it('updates membership if already exists', async () => {
      const client = setupDb();
      await setupApp(client);

      const groupId = await createGroup();

      await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        payload: { userId: 1, isAdmin: false },
      });

      const response = await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        payload: { userId: 1, isAdmin: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().isAdmin).toBe(true);

      const db = drizzle(client.db, { schema });
      const memberships = db.select().from(schema.userGroupUser)
        .where(and(
          eq(schema.userGroupUser.userGroupId, groupId),
          eq(schema.userGroupUser.userId, 1),
        ))
        .all();
      expect(memberships.length).toBe(1);
    });

    it('removes a member from a group', async () => {
      const client = setupDb();
      await setupApp(client);

      const groupId = await createGroup();

      await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        payload: { userId: 1 },
      });

      const response = await app.server.inject({
        method: 'DELETE',
        url: `/userGroup/${groupId}/members/1`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when removing non-existent membership', async () => {
      const client = setupDb();
      await setupApp(client);

      const groupId = await createGroup();

      const response = await app.server.inject({
        method: 'DELETE',
        url: `/userGroup/${groupId}/members/9999`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('lists group members', async () => {
      const client = setupDb();
      await setupApp(client);

      const groupId = await createGroup();

      await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        payload: { userId: 1, isAdmin: true },
      });

      const response = await app.server.inject({
        method: 'GET',
        url: `/userGroup/${groupId}/members`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.length).toBe(1);
      expect(body[0].userId).toBe(1);
      expect(body[0].isAdmin).toBe(true);
    });

    it('returns 404 for non-existent group', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/userGroup/9999/members',
      });

      expect(response.statusCode).toBe(404);
    });

    it('requires UserAdmin to add members', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const groupId = await createGroup();
      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: `/userGroup/${groupId}/members`,
        headers: { authorization: `Bearer ${token}` },
        payload: { userId: 1 },
      });

      expect(response.statusCode).toBe(403);
    });

    it('requires UserAdmin to remove members', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const groupId = await createGroup();
      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'DELETE',
        url: `/userGroup/${groupId}/members/1`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Activity tracking
  // ---------------------------------------------------------------------------

  describe('activity tracking', () => {
    it('tracks request activity in-memory and flushes to DB', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const tracker = new ActivityTracker(db);

      tracker.increment(1);
      tracker.increment(1);
      tracker.increment(1);

      expect(tracker.pendingCount).toBe(1);

      tracker.flush();

      expect(tracker.pendingCount).toBe(0);

      const activities = db.select().from(schema.userActivity)
        .where(eq(schema.userActivity.userId, 1))
        .all();
      expect(activities.length).toBe(1);
      expect(activities[0].count).toBe(3);
    });

    it('accumulates counts across flushes', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const tracker = new ActivityTracker(db);

      tracker.increment(1);
      tracker.flush();

      tracker.increment(1);
      tracker.increment(1);
      tracker.flush();

      const activities = db.select().from(schema.userActivity)
        .where(eq(schema.userActivity.userId, 1))
        .all();
      expect(activities.length).toBe(1);
      expect(activities[0].count).toBe(3);
    });

    it('tracks multiple users separately', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const person2 = db.insert(schema.person).values({}).returning().get();
      const user2 = db.insert(schema.user).values({ personId: person2.id, status: 'active' }).returning().get();

      const tracker = new ActivityTracker(db);

      tracker.increment(1);
      tracker.increment(user2.id);
      tracker.increment(user2.id);
      tracker.flush();

      const act1 = db.select().from(schema.userActivity)
        .where(eq(schema.userActivity.userId, 1))
        .all();
      const act2 = db.select().from(schema.userActivity)
        .where(eq(schema.userActivity.userId, user2.id))
        .all();

      expect(act1.length).toBe(1);
      expect(act1[0].count).toBe(1);
      expect(act2.length).toBe(1);
      expect(act2[0].count).toBe(2);
    });
  });
});
