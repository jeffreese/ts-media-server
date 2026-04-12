import { describe, it, expect, afterEach, beforeEach } from 'vitest';
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

function seedMediaItem(
  client: DatabaseClient,
  options: {
    name?: string;
    description?: string | null;
    type?: string;
    startDate?: string | null;
    endDate?: string | null;
    hash?: string | null;
    info?: Record<string, unknown> | null;
  } = {},
): number {
  const db = drizzle(client.db, { schema });

  const mediaItem = db
    .insert(schema.mediaItem)
    .values({
      name: options.name ?? 'test-photo',
      description: options.description === undefined ? null : options.description,
      type: options.type ?? 'Photo',
      startDate: options.startDate === undefined ? '2024-06-15T12:00:00Z' : options.startDate,
      endDate: options.endDate === undefined ? null : options.endDate,
      hash: options.hash === undefined ? '1010101010101010' : options.hash,
      info: options.info === undefined ? { camera: 'Canon EOS R5' } : options.info,
    })
    .returning()
    .get();

  return mediaItem.id;
}

describe('media-item routes', () => {
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

  describe('GET /mediaItem/:id', () => {
    it('returns media item details', async () => {
      const client = setupDb();
      const mediaItemId = seedMediaItem(client, {
        name: 'sunset',
        description: 'A beautiful sunset',
        type: 'Photo',
        startDate: '2024-06-15T18:30:00Z',
        hash: '1100110011001100',
        info: { camera: 'Sony A7III', lens: '24-70mm' },
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(mediaItemId);
      expect(body.name).toBe('sunset');
      expect(body.description).toBe('A beautiful sunset');
      expect(body.type).toBe('Photo');
      expect(body.startDate).toBe('2024-06-15T18:30:00Z');
      expect(body.hash).toBe('1100110011001100');
      expect(body.info).toEqual({ camera: 'Sony A7III', lens: '24-70mm' });
    });

    it('does not include file data in the response', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const mediaItemId = seedMediaItem(client);

      const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
      const pathRecord = db
        .insert(schema.path)
        .values({ dir: '/photos', hostId: host.id })
        .returning()
        .get();
      const file = db
        .insert(schema.file)
        .values({ name: 'test-photo', extension: 'jpg', pathId: pathRecord.id, type: 'image' })
        .returning()
        .get();
      db.insert(schema.mediaItemFile)
        .values({ mediaItemId, fileId: file.id, isPrimary: true })
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).not.toHaveProperty('files');
      expect(body).not.toHaveProperty('mediaItemFiles');
      expect(body).not.toHaveProperty('fileId');
      expect(body).not.toHaveProperty('pathId');
      expect(body).not.toHaveProperty('dir');
      expect(body).not.toHaveProperty('extension');
    });

    it('returns 404 when the media item does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/99999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Media item not found');
    });

    it('returns 400 for an invalid ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/abc',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for a negative ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/mediaItem/-1',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns null fields when optional data is absent', async () => {
      const client = setupDb();
      const mediaItemId = seedMediaItem(client, {
        name: 'minimal',
        description: null,
        startDate: null,
        endDate: null,
        hash: null,
        info: null,
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(mediaItemId);
      expect(body.name).toBe('minimal');
      expect(body.description).toBeNull();
      expect(body.endDate).toBeNull();
    });
  });

  describe('authentication', () => {
    it('requires authentication when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      const mediaItemId = seedMediaItem(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/mediaItem/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
