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

describe('media item detail routes', () => {
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

  afterEach(async () => {
    await app?.close();
    for (const c of clients) c.db.close();
    clients.length = 0;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // GET /mediaItem/:mediaItemId/features
  // ---------------------------------------------------------------------------

  describe('GET /mediaItem/:mediaItemId/features', () => {
    it('returns features for a media item', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item = db.insert(schema.mediaItem)
        .values({ name: 'photo1', type: 'image' })
        .returning()
        .get();

      db.insert(schema.feature).values([
        { itemId: item.id, coordinates: '10,20,50,50', label: 'face1' },
        { itemId: item.id, coordinates: '100,200,80,80', label: 'face2' },
      ]).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item.id}/features`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.items[0].label).toBe('face1');
    });

    it('returns empty list when media item has no features', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item = db.insert(schema.mediaItem)
        .values({ name: 'photo_noface', type: 'image' })
        .returning()
        .get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item.id}/features`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/9999/features',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('not found');
    });

    it('returns 400 for invalid media item ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/abc/features',
      });

      expect(res.statusCode).toBe(400);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item = db.insert(schema.mediaItem)
        .values({ name: 'photo_many', type: 'image' })
        .returning()
        .get();

      for (let i = 0; i < 5; i++) {
        db.insert(schema.feature).values({
          itemId: item.id,
          coordinates: `${i * 10},${i * 10},30,30`,
          label: `face${i}`,
        }).run();
      }

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item.id}/features?limit=2&offset=1`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.offset).toBe(1);
    });

    it('requires auth when enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const db = drizzle(client.db, { schema });
      db.insert(schema.mediaItem).values({ name: 'photo', type: 'image' }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/1/features',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /mediaItem/:mediaItemId/matches
  // ---------------------------------------------------------------------------

  describe('GET /mediaItem/:mediaItemId/matches', () => {
    it('returns matches for a media item', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item1 = db.insert(schema.mediaItem)
        .values({ name: 'photo_a', type: 'image' })
        .returning()
        .get();
      const item2 = db.insert(schema.mediaItem)
        .values({ name: 'photo_b', type: 'image' })
        .returning()
        .get();
      const item3 = db.insert(schema.mediaItem)
        .values({ name: 'photo_c', type: 'image' })
        .returning()
        .get();

      db.insert(schema.mediaMatch).values([
        { mediaItemId: item1.id, matchingItemId: item2.id },
        { mediaItemId: item3.id, matchingItemId: item1.id },
      ]).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item1.id}/matches`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('returns empty list when no matches exist', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item = db.insert(schema.mediaItem)
        .values({ name: 'isolated', type: 'image' })
        .returning()
        .get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item.id}/matches`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/9999/matches',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('not found');
    });

    it('returns 400 for invalid media item ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/xyz/matches',
      });

      expect(res.statusCode).toBe(400);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const item1 = db.insert(schema.mediaItem)
        .values({ name: 'source', type: 'image' })
        .returning()
        .get();

      for (let i = 0; i < 5; i++) {
        const other = db.insert(schema.mediaItem)
          .values({ name: `match${i}`, type: 'image' })
          .returning()
          .get();
        db.insert(schema.mediaMatch).values({
          mediaItemId: item1.id,
          matchingItemId: other.id,
        }).run();
      }

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${item1.id}/matches?limit=2&offset=0`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
    });

    it('requires auth when enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const db = drizzle(client.db, { schema });
      db.insert(schema.mediaItem).values({ name: 'photo', type: 'image' }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/1/matches',
      });

      expect(res.statusCode).toBe(401);
    });

    it('succeeds with token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const db = drizzle(client.db, { schema });
      db.insert(schema.mediaItem).values({ name: 'photo', type: 'image' }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/1/matches',
        headers: { authorization: `Bearer ${getAuthToken()}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
