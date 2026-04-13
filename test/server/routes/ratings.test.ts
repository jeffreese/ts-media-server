import { describe, it, expect, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import { NotificationService } from '../../../src/services/notification.js';
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

describe('rating routes', () => {
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

  function createMediaItem(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
    const path = db.insert(schema.path).values({ dir: '/photos', hostId: host.id }).returning().get();
    const file = db.insert(schema.file).values({ name: 'photo', extension: 'jpg', pathId: path.id }).returning().get();
    const item = db.insert(schema.mediaItem).values({ name: 'Test Photo', type: 'image' }).returning().get();
    db.insert(schema.mediaItemFile).values({ mediaItemId: item.id, fileId: file.id, isPrimary: 1 }).run();
    return item.id;
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
  // GET /mediaItem/:mediaItemId/ratings
  // ---------------------------------------------------------------------------

  describe('GET /mediaItem/:mediaItemId/ratings', () => {
    it('returns empty list for a media item with no ratings', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/ratings`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns ratings for a media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 4, comment: 'Great photo' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/ratings`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.items[0].rating).toBe(4);
      expect(body.items[0].comment).toBe('Great photo');
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      const db = drizzle(client.db, { schema });

      const user2 = db.insert(schema.user).values({ status: 'active' }).returning().get();
      db.insert(schema.userRating).values({ userId: user2.id, itemId: mediaItemId, rating: 3, date: new Date().toISOString() }).run();

      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 5 },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/ratings?offset=0&limit=1`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(2);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(1);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/9999/ratings',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid media item ID', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/abc/ratings',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /mediaItem/:mediaItemId/rating — upsert
  // ---------------------------------------------------------------------------

  describe('POST /mediaItem/:mediaItemId/rating', () => {
    it('creates a new rating', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 5, comment: 'Amazing!' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.rating).toBe(5);
      expect(body.comment).toBe('Amazing!');
      expect(body.date).toBeDefined();
    });

    it('creates a rating without a comment', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rating).toBe(3);
      expect(body.comment).toBeNull();
    });

    it('upserts when the same user rates the same item again', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3, comment: 'OK' },
      });
      const firstId = first.json().id;

      const second = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 5, comment: 'Actually great' },
      });

      expect(second.statusCode).toBe(200);
      const body = second.json();
      expect(body.id).toBe(firstId);
      expect(body.rating).toBe(5);
      expect(body.comment).toBe('Actually great');

      const db = drizzle(client.db, { schema });
      const count = db.select().from(schema.userRating).all();
      expect(count).toHaveLength(1);
    });

    it('updates timestamp on upsert', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3 },
      });
      const firstDate = first.json().date;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 4 },
      });
      const secondDate = second.json().date;

      expect(secondDate).not.toBe(firstDate);
    });

    it('emits create notification for new rating', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 4 },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('create');
      expect(event.source).toBe('userRating');
    });

    it('emits update notification on upsert', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3 },
      });

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 5 },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('userRating');
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/mediaItem/9999/rating',
        payload: { rating: 4 },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for missing rating field', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for rating out of range', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const tooLow = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 0 },
      });
      expect(tooLow.statusCode).toBe(400);

      const tooHigh = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 6 },
      });
      expect(tooHigh.statusCode).toBe(400);
    });

    it('returns 400 for non-integer rating', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3.5 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /mediaItem/:mediaItemId/rating
  // ---------------------------------------------------------------------------

  describe('DELETE /mediaItem/:mediaItemId/rating', () => {
    it('removes the current user\'s rating', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 4 },
      });

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/rating`,
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/ratings`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('emits delete notification', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/rating`,
        payload: { rating: 3 },
      });

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/rating`,
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('delete');
      expect(event.source).toBe('userRating');
    });

    it('returns 404 when no rating exists', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/rating`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid media item ID', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: '/mediaItem/abc/rating',
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
