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

describe('search routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  function seedMedia(client: DatabaseClient) {
    const db = drizzle(client.db, { schema });

    db.insert(schema.mediaItem).values([
      { name: 'sunset_beach', type: 'image', startDate: '2025-06-01' },
      { name: 'mountain_hike', type: 'image', startDate: '2025-07-15' },
      { name: 'city_tour', type: 'video', startDate: '2025-08-20' },
      { name: 'forest_walk', type: 'image', startDate: '2025-09-10' },
    ]).run();

    const kw1 = db.insert(schema.keyword).values({ word: 'nature' }).returning().get();
    const kw2 = db.insert(schema.keyword).values({ word: 'urban' }).returning().get();

    db.insert(schema.mediaItemKeyword).values([
      { mediaItemId: 1, keywordId: kw1.id },
      { mediaItemId: 2, keywordId: kw1.id },
      { mediaItemId: 4, keywordId: kw1.id },
      { mediaItemId: 3, keywordId: kw2.id },
    ]).run();
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
  // GET /search
  // ---------------------------------------------------------------------------

  describe('GET /search', () => {
    it('returns all media items with no filters', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(4);
      expect(body.total).toBe(4);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(50);
    });

    it('filters by name query', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search?q=mountain' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('mountain_hike');
    });

    it('filters by media type', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search?type=video' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('city_tour');
    });

    it('filters by date range', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/search?dateStart=2025-07-01&dateEnd=2025-08-31',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      const names = body.items.map((i: { name: string }) => i.name).sort();
      expect(names).toEqual(['city_tour', 'mountain_hike']);
    });

    it('filters by keyword', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search?keyword=nature' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(3);
    });

    it('returns empty results for a non-existent keyword', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search?keyword=nonexistent' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('combines multiple filters', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/search?keyword=nature&type=image&dateStart=2025-07-01',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search?limit=2&offset=1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.offset).toBe(1);
      expect(body.limit).toBe(2);
      expect(body.total).toBe(4);
    });

    it('requires auth when enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/search' });
      expect(res.statusCode).toBe(401);
    });

    it('succeeds with token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({
        method: 'GET',
        url: '/search',
        headers: { authorization: `Bearer ${getAuthToken()}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /keywords
  // ---------------------------------------------------------------------------

  describe('GET /keywords', () => {
    it('returns all keywords with usage counts', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/keywords' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);

      const nature = body.items.find((k: { word: string }) => k.word === 'nature');
      expect(nature).toBeDefined();
      expect(Number(nature.count)).toBe(3);

      const urban = body.items.find((k: { word: string }) => k.word === 'urban');
      expect(urban).toBeDefined();
      expect(Number(urban.count)).toBe(1);
    });

    it('returns empty list when no keywords exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/keywords' });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/keywords?limit=1&offset=0' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /keywords/:keywordId/items
  // ---------------------------------------------------------------------------

  describe('GET /keywords/:keywordId/items', () => {
    it('returns media items for a keyword', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const db = drizzle(client.db, { schema });
      const kw = db.select().from(schema.keyword).where(eq(schema.keyword.word, 'nature')).get()!;

      const res = await app.server.inject({ method: 'GET', url: `/keywords/${kw.id}/items` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.keyword.word).toBe('nature');
      expect(body.items).toHaveLength(3);
      expect(body.total).toBe(3);
    });

    it('returns 404 for a non-existent keyword ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/keywords/9999/items' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('not found');
    });

    it('returns 400 for an invalid keyword ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const res = await app.server.inject({ method: 'GET', url: '/keywords/abc/items' });
      expect(res.statusCode).toBe(400);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      seedMedia(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const db = drizzle(client.db, { schema });
      const kw = db.select().from(schema.keyword).where(eq(schema.keyword.word, 'nature')).get()!;

      const res = await app.server.inject({ method: 'GET', url: `/keywords/${kw.id}/items?limit=1` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(3);
    });
  });
});
