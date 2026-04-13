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

describe('places routes', () => {
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

  function createPlace(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const place = db.insert(schema.place).values({}).returning().get();
    return place.id;
  }

  function createMediaItem(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
    const path = db.insert(schema.path).values({ dir: '/photos', hostId: host.id }).returning().get();
    const file = db.insert(schema.file).values({ name: 'photo', extension: 'jpg', pathId: path.id }).returning().get();
    const item = db.insert(schema.mediaItem).values({ name: 'Test Photo', type: 'image' }).returning().get();
    db.insert(schema.mediaItemFile).values({ mediaItemId: item.id, fileId: file.id, isPrimary: true }).run();
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
  // Place Names
  // ---------------------------------------------------------------------------

  describe('GET /place/:placeId/names', () => {
    it('returns empty list for a place with no names', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/names`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(res.json().total).toBe(0);
    });

    it('returns names for a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'Central Park', preferred: true },
      });
      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'The Park' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/names`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().total).toBe(2);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        await app.server.inject({
          method: 'POST',
          url: `/place/${placeId}/names`,
          payload: { name },
        });
      }

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/names?offset=0&limit=2`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
      expect(res.json().total).toBe(3);
    });

    it('returns 404 for non-existent place', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/place/9999/names',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /place/:placeId/names', () => {
    it('creates a name for a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'Grand Canyon', preferred: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Grand Canyon');
      expect(body.preferred).toBe(true);
      expect(body.placeId).toBe(placeId);
    });

    it('clears preferred flag on existing names when setting a new preferred', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const first = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'First Name', preferred: true },
      });
      const firstId = first.json().id;

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'Second Name', preferred: true },
      });

      const db = drizzle(client.db, { schema });
      const firstUpdated = db.select().from(schema.placeName).where(eq(schema.placeName.id, firstId)).get();
      expect(firstUpdated!.preferred).toBe(false);
    });

    it('emits an update notification on the place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'Test Place' },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('place');
    });

    it('returns 400 for empty name', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent place', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/place/9999/names',
        payload: { name: 'Test' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /place/:placeId/names', () => {
    it('removes a name from a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/names`,
        payload: { name: 'To Remove' },
      });
      const nameId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeId}/names`,
        payload: { id: nameId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/names`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('returns 404 for name not belonging to this place', async () => {
      const client = setupDb();
      const placeA = createPlace(client);
      const placeB = createPlace(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeA}/names`,
        payload: { name: 'Place A Name' },
      });
      const nameId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeB}/names`,
        payload: { id: nameId },
      });

      expect(deleteRes.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Place-Media linking
  // ---------------------------------------------------------------------------

  describe('GET /place/:placeId/media', () => {
    it('returns empty list for a place with no media', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/media`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(res.json().total).toBe(0);
    });

    it('returns linked media with media item details', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/media`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.mediaId).toBe(mediaId);
      expect(item.mediaName).toBe('Test Photo');
      expect(item.mediaType).toBe('image');
    });

    it('returns 404 for non-existent place', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/place/9999/media',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /place/:placeId/media', () => {
    it('links a media item to a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mediaId).toBe(mediaId);
      expect(body.placeId).toBe(placeId);
    });

    it('returns alreadyLinked when media is already linked', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().alreadyLinked).toBe(true);
    });

    it('returns 404 for non-existent media item', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId: 9999 },
      });

      expect(res.statusCode).toBe(404);
    });

    it('emits an update notification on the place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('place');
    });
  });

  describe('DELETE /place/:placeId/media', () => {
    it('removes a media link from a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/media`,
        payload: { mediaId },
      });
      const linkId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeId}/media`,
        payload: { id: linkId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/media`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('returns 404 for link not belonging to this place', async () => {
      const client = setupDb();
      const placeA = createPlace(client);
      const placeB = createPlace(client);
      const mediaId = createMediaItem(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeA}/media`,
        payload: { mediaId },
      });
      const linkId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeB}/media`,
        payload: { id: linkId },
      });

      expect(deleteRes.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Place Addresses
  // ---------------------------------------------------------------------------

  describe('GET /place/:placeId/addresses', () => {
    it('returns empty list for a place with no addresses', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/addresses`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(res.json().total).toBe(0);
    });

    it('returns addresses for a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/addresses`,
        payload: { street: '123 Main St', city: 'Springfield', state: 'IL' },
      });

      const res = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/addresses`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.street).toBe('123 Main St');
      expect(item.city).toBe('Springfield');
      expect(item.placeId).toBe(placeId);
    });

    it('returns 404 for non-existent place', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'GET',
        url: '/place/9999/addresses',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /place/:placeId/addresses', () => {
    it('creates an address linked to a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/addresses`,
        payload: {
          street: '789 Elm St',
          city: 'Portland',
          state: 'OR',
          postalCode: '97201',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.street).toBe('789 Elm St');
      expect(body.city).toBe('Portland');
      expect(body.placeId).toBe(placeId);
    });

    it('returns 404 for non-existent place', async () => {
      const client = setupDb();
      await setupApp(client);

      const res = await app.server.inject({
        method: 'POST',
        url: '/place/9999/addresses',
        payload: { street: '123 Main St' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('emits an update notification on the place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/addresses`,
        payload: { street: '100 Broad St' },
      });

      expect(events).toHaveLength(1);
      const event = events[0] as Record<string, unknown>;
      expect(event.action).toBe('update');
      expect(event.source).toBe('place');
    });
  });

  describe('DELETE /place/:placeId/addresses', () => {
    it('removes an address from a place', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeId}/addresses`,
        payload: { street: 'Delete Me St' },
      });
      const addressId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeId}/addresses`,
        payload: { id: addressId },
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      const listRes = await app.server.inject({
        method: 'GET',
        url: `/place/${placeId}/addresses`,
      });
      expect(listRes.json().items).toHaveLength(0);
    });

    it('returns 404 for address not belonging to this place', async () => {
      const client = setupDb();
      const placeA = createPlace(client);
      const placeB = createPlace(client);
      await setupApp(client);

      const createRes = await app.server.inject({
        method: 'POST',
        url: `/place/${placeA}/addresses`,
        payload: { street: 'Place A St' },
      });
      const addressId = createRes.json().id;

      const deleteRes = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeB}/addresses`,
        payload: { id: addressId },
      });

      expect(deleteRes.statusCode).toBe(404);
    });

    it('returns 400 for missing id', async () => {
      const client = setupDb();
      const placeId = createPlace(client);
      await setupApp(client);

      const res = await app.server.inject({
        method: 'DELETE',
        url: `/place/${placeId}/addresses`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
