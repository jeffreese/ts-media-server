import { describe, it, expect, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
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

describe('keyword tagging routes', () => {
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
  // GET /mediaItem/:mediaItemId/keywords
  // ---------------------------------------------------------------------------

  describe('GET /mediaItem/:mediaItemId/keywords', () => {
    it('returns empty list for a media item with no keywords', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/keywords`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns tagged keywords for a media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'sunset' },
      });
      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'beach' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/keywords`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);

      const words = body.items.map((k: { word: string }) => k.word).sort();
      expect(words).toEqual(['beach', 'sunset']);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      for (const word of ['alpha', 'beta', 'gamma']) {
        await app.server.inject({
          method: 'POST',
          url: `/mediaItem/${mediaItemId}/keywords`,
          payload: { word },
        });
      }

      const res = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/keywords?offset=0&limit=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(2);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/9999/keywords',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid media item ID', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/abc/keywords',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /mediaItem/:mediaItemId/keywords
  // ---------------------------------------------------------------------------

  describe('POST /mediaItem/:mediaItemId/keywords', () => {
    it('tags a media item with a new keyword', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'landscape' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.word).toBe('landscape');
      expect(body.alreadyTagged).toBe(false);
    });

    it('normalizes keyword to lowercase and trims whitespace', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: '  Sunset  ' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().word).toBe('sunset');
    });

    it('reuses existing keyword when tagging with an existing word', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'nature' },
      });

      const secondMediaItemId = createMediaItem(client);
      const second = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${secondMediaItemId}/keywords`,
        payload: { word: 'nature' },
      });

      expect(first.json().id).toBe(second.json().id);
    });

    it('returns alreadyTagged: true when keyword is already assigned', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'portrait' },
      });

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'portrait' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().alreadyTagged).toBe(true);
    });

    it('emits an update notification on the media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'architecture' },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('mediaItem');
    });

    it('does not emit notification when keyword is already tagged', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'mountain' },
      });

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'mountain' },
      });

      expect(events).toHaveLength(0);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/mediaItem/9999/keywords',
        payload: { word: 'test' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for empty word', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for missing word field', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /mediaItem/:mediaItemId/keywords
  // ---------------------------------------------------------------------------

  describe('DELETE /mediaItem/:mediaItemId/keywords', () => {
    it('removes a keyword tag from a media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const tagRes = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'ocean' },
      });
      const keywordId = tagRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { keywordId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}/keywords`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('does not delete the keyword record itself', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const tagRes = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'river' },
      });
      const keywordId = tagRes.json().id;

      await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { keywordId },
      });

      const db = drizzle(client.db, { schema });
      const keyword = db
        .select()
        .from(schema.keyword)
        .where(eq(schema.keyword.id, keywordId))
        .get();
      expect(keyword).toBeDefined();
      expect(keyword!.word).toBe('river');
    });

    it('emits an update notification on the media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const tagRes = await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { word: 'forest' },
      });
      const keywordId = tagRes.json().id;

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { keywordId },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('mediaItem');
    });

    it('returns 404 when keyword is not tagged on the media item', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: { keywordId: 9999 },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for missing keywordId', async () => {
      const client = setupDb();
      const mediaItemId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: `/mediaItem/${mediaItemId}/keywords`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Unique keyword enforcement
  // ---------------------------------------------------------------------------

  describe('unique keyword enforcement', () => {
    it('enforces unique keywords at the schema level', async () => {
      const client = setupDb();
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: '/keyword',
        payload: { word: 'unique-word' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.server.inject({
        method: 'POST',
        url: '/keyword',
        payload: { word: 'unique-word' },
      });
      expect(second.statusCode).toBe(500);
    });

    it('creates only one keyword record when tagging multiple items with the same word', async () => {
      const client = setupDb();
      const itemA = createMediaItem(client);
      const itemB = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${itemA}/keywords`,
        payload: { word: 'shared-tag' },
      });
      await app.server.inject({
        method: 'POST',
        url: `/mediaItem/${itemB}/keywords`,
        payload: { word: 'shared-tag' },
      });

      const db = drizzle(client.db, { schema });
      const keywords = db
        .select()
        .from(schema.keyword)
        .where(eq(schema.keyword.word, 'shared-tag'))
        .all();
      expect(keywords).toHaveLength(1);
    });
  });
});
