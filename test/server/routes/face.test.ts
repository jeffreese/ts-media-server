import { describe, it, expect, afterEach } from 'vitest';
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

function seedFeature(
  client: DatabaseClient,
  options: { thumbnail?: Buffer | null },
): { featureId: number; mediaItemId: number } {
  const db = drizzle(client.db, { schema });

  const mediaItem = db
    .insert(schema.mediaItem)
    .values({ name: 'face-item', type: 'image' })
    .returning()
    .get();

  const feature = db
    .insert(schema.feature)
    .values({
      itemId: mediaItem.id,
      thumbnail: options.thumbnail ?? null,
      info: {},
    })
    .returning()
    .get();

  return { featureId: feature.id, mediaItemId: mediaItem.id };
}

describe('face routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
  });

  describe('GET /face/:id', () => {
    it('serves the face thumbnail JPEG from the database', async () => {
      const client = setupDb();
      const thumb = Buffer.from('fake-jpeg-face-crop');
      const { featureId } = seedFeature(client, { thumbnail: thumb });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/face/${featureId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['cache-control']).toContain('public');
      expect(response.rawPayload).toEqual(thumb);
    });

    it('returns 404 when the feature does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/face/99999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Feature not found');
    });

    it('returns 404 when the thumbnail blob is missing', async () => {
      const client = setupDb();
      const { featureId } = seedFeature(client, { thumbnail: null });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/face/${featureId}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('thumbnail');
    });

    it('returns 400 for an invalid ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/face/abc',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /face/:id version redirect', () => {
    it('redirects with 301 when v param does not match db_date', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const dbDate = db
        .select({ value: schema.setting.value })
        .from(schema.setting)
        .where(eq(schema.setting.key, 'db_date'))
        .get();

      const { featureId } = seedFeature(client, { thumbnail: Buffer.from('x') });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/face/${featureId}?v=stale&db=stale`,
      });

      expect(response.statusCode).toBe(301);
      const loc = new URL(response.headers.location!, 'http://localhost');
      expect(loc.pathname).toBe(`/face/${featureId}`);
      expect(loc.searchParams.get('v')).toBe(dbDate!.value);
      expect(loc.searchParams.get('db')).toBe(dbDate!.value);
    });

    it('serves normally when v matches db_date', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const dbDate = db
        .select({ value: schema.setting.value })
        .from(schema.setting)
        .where(eq(schema.setting.key, 'db_date'))
        .get();

      const thumb = Buffer.from('versioned-thumb');
      const { featureId } = seedFeature(client, { thumbnail: thumb });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/face/${featureId}?v=${dbDate!.value}&db=${dbDate!.value}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(thumb);
    });
  });

  describe('GET /matchingFaces/:id', () => {
    it('returns transitively matched distinct media items', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const itemA = db.insert(schema.mediaItem).values({ name: 'a', type: 'image' }).returning().get();
      const itemB = db.insert(schema.mediaItem).values({ name: 'b', type: 'image' }).returning().get();
      const itemC = db.insert(schema.mediaItem).values({ name: 'c', type: 'image' }).returning().get();

      const fA = db.insert(schema.feature).values({ itemId: itemA.id, info: {} }).returning().get();
      const fB = db.insert(schema.feature).values({ itemId: itemB.id, info: {} }).returning().get();
      const fC = db.insert(schema.feature).values({ itemId: itemC.id, info: {} }).returning().get();

      const iso = new Date().toISOString();
      db.insert(schema.featureMatch)
        .values({
          featureId: fA.id,
          matchingFeatureId: fB.id,
          matchInfo: { similarity: 0.95, match_date: iso },
        })
        .run();
      db.insert(schema.featureMatch)
        .values({
          featureId: fB.id,
          matchingFeatureId: fC.id,
          matchInfo: { similarity: 0.9, match_date: iso },
        })
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/matchingFaces/${fA.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        items: { featureId: number; mediaItemId: number }[];
        total: number;
        offset: number;
        limit: number;
      };
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);
      const mediaIds = body.items.map((i) => i.mediaItemId).sort((x, y) => x - y);
      expect(mediaIds).toEqual([itemB.id, itemC.id].sort((x, y) => x - y));
    });

    it('paginates with offset and limit', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const itemA = db.insert(schema.mediaItem).values({ name: 'a', type: 'image' }).returning().get();
      const itemB = db.insert(schema.mediaItem).values({ name: 'b', type: 'image' }).returning().get();
      const itemC = db.insert(schema.mediaItem).values({ name: 'c', type: 'image' }).returning().get();

      const fA = db.insert(schema.feature).values({ itemId: itemA.id, info: {} }).returning().get();
      const fB = db.insert(schema.feature).values({ itemId: itemB.id, info: {} }).returning().get();
      const fC = db.insert(schema.feature).values({ itemId: itemC.id, info: {} }).returning().get();

      const iso = new Date().toISOString();
      db.insert(schema.featureMatch)
        .values({ featureId: fA.id, matchingFeatureId: fB.id, matchInfo: { similarity: 0.95, match_date: iso } })
        .run();
      db.insert(schema.featureMatch)
        .values({ featureId: fB.id, matchingFeatureId: fC.id, matchInfo: { similarity: 0.9, match_date: iso } })
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/matchingFaces/${fA.id}?offset=0&limit=1`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: unknown[]; total: number; limit: number; offset: number };
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(1);
    });

    it('returns 404 when the feature does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/matchingFaces/99999',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns empty items when there are no matches', async () => {
      const client = setupDb();
      const { featureId } = seedFeature(client, { thumbnail: Buffer.from('x') });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/matchingFaces/${featureId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: unknown[]; total: number };
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  describe('authentication', () => {
    it('requires authentication for /face when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      const { featureId } = seedFeature(client, { thumbnail: Buffer.from('x') });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/face/${featureId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('requires authentication for /matchingFaces when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      const { featureId } = seedFeature(client, { thumbnail: Buffer.from('x') });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/matchingFaces/${featureId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
