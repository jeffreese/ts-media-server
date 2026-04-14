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

describe('map routes', () => {
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
  // GET /map/media
  // ---------------------------------------------------------------------------

  describe('GET /map/media', () => {
    it('returns GPS-tagged media items', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      db.insert(schema.mediaItem).values([
        {
          name: 'geotagged_photo',
          type: 'image',
          info: { gps: { latitude: 34.0522, longitude: -118.2437 } },
        },
        {
          name: 'another_geo',
          type: 'image',
          info: { gps: { latitude: 40.7128, longitude: -74.006 } },
        },
        {
          name: 'no_gps_photo',
          type: 'image',
          info: { camera: { make: 'Canon' } },
        },
        {
          name: 'null_info',
          type: 'image',
        },
      ]).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/map/media' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);

      const la = body.items.find((i: { name: string }) => i.name === 'geotagged_photo');
      expect(la).toBeDefined();
      expect(la.latitude).toBeCloseTo(34.0522);
      expect(la.longitude).toBeCloseTo(-118.2437);
    });

    it('returns empty list when no media has GPS data', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      db.insert(schema.mediaItem).values([
        { name: 'photo1', type: 'image', info: { camera: { make: 'Sony' } } },
        { name: 'photo2', type: 'image' },
      ]).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/map/media' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      for (let i = 0; i < 5; i++) {
        db.insert(schema.mediaItem).values({
          name: `geo_${i}`,
          type: 'image',
          info: { gps: { latitude: 30 + i, longitude: -100 + i } },
        }).run();
      }

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/map/media?limit=2&offset=1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.offset).toBe(1);
    });

    it('requires auth when enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/map/media' });
      expect(res.statusCode).toBe(401);
    });

    it('succeeds with token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/map/media',
        headers: { authorization: `Bearer ${getAuthToken()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns correct fields for each item', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      db.insert(schema.mediaItem).values({
        name: 'test_fields',
        type: 'video',
        info: { gps: { latitude: 51.5074, longitude: -0.1278 } },
      }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/map/media' });
      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name', 'test_fields');
      expect(item).toHaveProperty('type', 'video');
      expect(item).toHaveProperty('latitude');
      expect(item).toHaveProperty('longitude');
    });
  });
});
