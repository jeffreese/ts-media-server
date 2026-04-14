import { describe, it, expect, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import * as schema from '../../../src/db/schema.js';
import type { Config } from '../../../src/config/schema.js';

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

describe('admin routes', () => {
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

  function getAuthToken(): string {
    return app.server.jwt.sign({ userId: 1 });
  }

  function createNonAdminToken(client: DatabaseClient): string {
    const db = drizzle(client.db, { schema });
    const person = db.insert(schema.person).values({}).returning().get();
    const user = db.insert(schema.user)
      .values({ personId: person.id, status: 'active' })
      .returning()
      .get();
    return app.server.jwt.sign({ userId: user.id });
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
  // GET /admin/stats
  // ---------------------------------------------------------------------------

  describe('GET /admin/stats', () => {
    it('returns server statistics', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('paths');
      expect(body).toHaveProperty('files');
      expect(body).toHaveProperty('mediaItems');
      expect(body).toHaveProperty('images');
      expect(body).toHaveProperty('videos');
      expect(body).toHaveProperty('features');
      expect(body).toHaveProperty('matches');
      expect(body).toHaveProperty('people');
      expect(body).toHaveProperty('places');
      expect(body).toHaveProperty('keywords');
      expect(body).toHaveProperty('users');
      expect(typeof body.mediaItems).toBe('number');
    });

    it('reflects actual data counts', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      db.insert(schema.mediaItem)
        .values([
          { name: 'photo1', type: 'image' },
          { name: 'photo2', type: 'image' },
          { name: 'video1', type: 'video' },
        ])
        .run();
      db.insert(schema.keyword).values({ word: 'sunset' }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      const body = response.json();
      expect(body.mediaItems).toBe(3);
      expect(body.images).toBe(2);
      expect(body.videos).toBe(1);
      expect(body.keywords).toBe(1);
    });

    it('requires SysAdmin access when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = createNonAdminToken(client);
      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/stats',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('succeeds with admin token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/stats',
        headers: { authorization: `Bearer ${getAuthToken()}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/paths
  // ---------------------------------------------------------------------------

  describe('GET /admin/paths', () => {
    it('returns empty list when no paths are indexed', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/paths',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().paths).toEqual([]);
    });

    it('returns indexed paths with file counts', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      db.insert(schema.host).values({ name: 'localhost' }).run();
      const pathRecord = db.insert(schema.path)
        .values({ dir: '/media/photos', hostId: 1 })
        .returning()
        .get();
      db.insert(schema.file)
        .values([
          { name: 'photo1', extension: 'jpg', pathId: pathRecord.id },
          { name: 'photo2', extension: 'jpg', pathId: pathRecord.id },
        ])
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/paths',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.paths).toHaveLength(1);
      expect(body.paths[0].dir).toBe('/media/photos');
      expect(body.paths[0].fileCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/settings
  // ---------------------------------------------------------------------------

  describe('GET /admin/settings', () => {
    it('returns all settings', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/settings',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.settings)).toBe(true);
      expect(body.settings.length).toBeGreaterThan(0);

      const authSetting = body.settings.find((s: { key: string }) => s.key === 'auth_status');
      expect(authSetting).toBeDefined();
      expect(authSetting.value).toBe('disabled');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /admin/settings/:key
  // ---------------------------------------------------------------------------

  describe('POST /admin/settings/:key', () => {
    it('updates a setting', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/settings/custom_test',
        payload: { value: 'test_value' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ key: 'custom_test', value: 'test_value' });

      const verify = await app.server.inject({
        method: 'GET',
        url: '/admin/settings/custom_test',
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json().value).toBe('test_value');
    });

    it('returns 400 when value is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/settings/some_key',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /admin/dir
  // ---------------------------------------------------------------------------

  describe('GET /admin/dir', () => {
    it('returns 400 when path query is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/dir',
      });

      expect(response.statusCode).toBe(400);
    });

    it('lists directory contents for a valid path', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/dir?path=/',
      });

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.json())).toBe(true);
    });

    it('returns 404 for non-existent path', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/dir?path=/nonexistent_path_xyz_123',
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects path with traversal', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/admin/dir?path=/tmp/../etc',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('traversal');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /admin/index
  // ---------------------------------------------------------------------------

  describe('POST /admin/index', () => {
    it('returns 501 when no onIndexDirectory handler is configured', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/index',
        payload: { directory: '/tmp' },
      });

      expect(response.statusCode).toBe(501);
    });

    it('starts indexing when handler is configured', async () => {
      const client = setupDb();
      const indexFn = vi.fn();
      app = await createApp({
        config: makeConfig(),
        db: client.db,
        loggerOptions,
        onIndexDirectory: indexFn,
      });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/index',
        payload: { directory: '/tmp', concurrency: 2 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('started');
      expect(indexFn).toHaveBeenCalledOnce();
    });

    it('returns 400 when directory is missing from body', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/index',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when directory does not exist', async () => {
      const client = setupDb();
      const indexFn = vi.fn();
      app = await createApp({
        config: makeConfig(),
        db: client.db,
        loggerOptions,
        onIndexDirectory: indexFn,
      });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/index',
        payload: { directory: '/nonexistent_dir_xyz_123' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /admin/reindex
  // ---------------------------------------------------------------------------

  describe('POST /admin/reindex', () => {
    it('returns no_paths when database has no indexed paths', async () => {
      const client = setupDb();
      const indexFn = vi.fn();
      app = await createApp({
        config: makeConfig(),
        db: client.db,
        loggerOptions,
        onIndexDirectory: indexFn,
      });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/reindex',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('no_paths');
      expect(indexFn).not.toHaveBeenCalled();
    });

    it('returns 501 when handler is not configured', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/admin/reindex',
        payload: {},
      });

      expect(response.statusCode).toBe(501);
    });
  });
});
