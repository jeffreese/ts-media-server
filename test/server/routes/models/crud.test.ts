import { describe, it, expect, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../../src/db/client.js';
import { runMigrations } from '../../../../src/db/migrate.js';
import { seedDatabase } from '../../../../src/db/seed.js';
import { createApp, type App } from '../../../../src/server/app.js';
import { NotificationService } from '../../../../src/services/notification.js';
import * as schema from '../../../../src/db/schema.js';
import type { Config } from '../../../../src/config/schema.js';

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

describe('generic model CRUD routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;
  let notifications: NotificationService;

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
    const user = db.insert(schema.user)
      .values({ personId: person.id, status: 'active' })
      .returning()
      .get();
    return user.id;
  }

  async function setupApp(client: DatabaseClient): Promise<void> {
    notifications = new NotificationService();
    app = await createApp({
      config: makeConfig(),
      db: client.db,
      loggerOptions,
      notificationService: notifications,
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
  // GET /:model/:id
  // ---------------------------------------------------------------------------

  describe('GET /:model/:id', () => {
    it('returns a record by id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component/1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(1);
      expect(body.key).toBe('SysAdmin');
    });

    it('returns 404 for non-existent id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component/9999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('not found');
    });

    it('returns 400 for invalid id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component/abc',
      });

      expect(response.statusCode).toBe(400);
    });

    it('requires authentication when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component/1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('succeeds with a valid token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component/1',
        headers: { authorization: `Bearer ${getAdminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().key).toBe('SysAdmin');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /:model (list)
  // ---------------------------------------------------------------------------

  describe('GET /:model (list)', () => {
    it('returns paginated results with total count', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBe(4);
      expect(body.total).toBe(4);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(50);
    });

    it('respects offset and limit parameters', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component?offset=1&limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBe(2);
      expect(body.offset).toBe(1);
      expect(body.limit).toBe(2);
      expect(body.total).toBe(4);
    });

    it('returns empty items when offset exceeds total', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component?offset=100',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toEqual([]);
      expect(body.total).toBe(4);
    });

    it('rejects invalid pagination parameters', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'GET',
        url: '/component?offset=-1',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /:model (create)
  // ---------------------------------------------------------------------------

  describe('POST /:model (create)', () => {
    it('creates a new record and returns it', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Editors', description: 'Can edit media' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Editors');
      expect(body.description).toBe('Can edit media');
    });

    it('emits a create notification', async () => {
      const client = setupDb();
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Viewers' },
      });

      expect(events.length).toBe(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('create');
      expect(event.source).toBe('userGroup');
    });

    it('returns 400 for non-object body', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: 'not json',
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /:model (update)
  // ---------------------------------------------------------------------------

  describe('POST /:model (update)', () => {
    it('updates an existing record when id is present', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Original' },
      });
      const created = createRes.json();

      const updateRes = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { id: created.id, name: 'Updated', description: 'New desc' },
      });

      expect(updateRes.statusCode).toBe(200);
      const updated = updateRes.json();
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New desc');
    });

    it('emits an update notification', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Test' },
      });
      const created = createRes.json();

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { id: created.id, name: 'Renamed' },
      });

      expect(events.length).toBe(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('userGroup');
    });

    it('returns 404 when updating a non-existent id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { id: 9999, name: 'Ghost' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when update body has only id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { id: 1 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('No fields');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /:model/:id
  // ---------------------------------------------------------------------------

  describe('DELETE /:model/:id', () => {
    it('deletes an existing record', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'ToDelete' },
      });
      const created = createRes.json();

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/userGroup/${created.id}`,
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const getRes = await app.server.inject({
        method: 'GET',
        url: `/userGroup/${created.id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('emits a delete notification', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/userGroup',
        payload: { name: 'Ephemeral' },
      });
      const created = createRes.json();

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'DELETE',
        url: `/userGroup/${created.id}`,
      });

      expect(events.length).toBe(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('delete');
      expect(event.source).toBe('userGroup');
    });

    it('returns 404 for non-existent id', async () => {
      const client = setupDb();
      await setupApp(client);

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/userGroup/9999',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Security enforcement
  // ---------------------------------------------------------------------------

  describe('security enforcement', () => {
    it('enforces SysAdmin for component save', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/component',
        headers: { authorization: `Bearer ${token}` },
        payload: { key: 'NewComp', label: 'New' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('SysAdmin');
    });

    it('enforces SysAdmin for component delete', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/component/1',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('SysAdmin');
    });

    it('allows SysAdmin to save components', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const response = await app.server.inject({
        method: 'POST',
        url: '/component',
        headers: { authorization: `Bearer ${getAdminToken()}` },
        payload: { key: 'Reports', label: 'Reports' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().key).toBe('Reports');
    });

    it('enforces SysAdmin for datatype save', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/datatype',
        headers: { authorization: `Bearer ${token}` },
        payload: { label: 'Custom' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('enforces UserAdmin for modifying other users', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/user/1',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('UserAdmin');
    });

    it('scopes userPreference access to the requesting user', async () => {
      const client = setupDb();
      enableAuth(client);
      await setupApp(client);

      const nonAdminId = createNonAdminUser(client);
      const token = app.server.jwt.sign({ userId: nonAdminId });

      const response = await app.server.inject({
        method: 'POST',
        url: '/userPreference',
        headers: { authorization: `Bearer ${token}` },
        payload: { userId: 1, key: 'theme', value: 'dark' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('own preferences');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple models work
  // ---------------------------------------------------------------------------

  describe('multiple models', () => {
    it('registers routes for person model', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/person',
        payload: { gender: 'female', birthday: '1990-01-15' },
      });

      expect(createRes.statusCode).toBe(200);
      const person = createRes.json();
      expect(person.id).toBeDefined();
      expect(person.gender).toBe('female');

      const getRes = await app.server.inject({
        method: 'GET',
        url: `/person/${person.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().gender).toBe('female');
    });

    it('registers routes for keyword model', async () => {
      const client = setupDb();
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: '/keyword',
        payload: { word: 'sunset' },
      });

      expect(createRes.statusCode).toBe(200);
      expect(createRes.json().word).toBe('sunset');

      const listRes = await app.server.inject({
        method: 'GET',
        url: '/keyword',
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().items.length).toBeGreaterThanOrEqual(1);
    });
  });
});
