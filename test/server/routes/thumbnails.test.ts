import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import * as schema from '../../../src/db/schema.js';
import { getThumbnailPath } from '../../../src/services/thumbnail.js';
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

function uniqueTmpDir(): string {
  const dir = join(tmpdir(), `thumbnails-route-test-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedMediaItem(
  client: DatabaseClient,
  options: {
    dir: string;
    fileName: string;
    extension: string;
    type?: string;
    createThumbnails?: number[];
  },
): { mediaItemId: number; filePath: string } {
  const db = drizzle(client.db, { schema });

  const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
  const pathRecord = db
    .insert(schema.path)
    .values({ dir: options.dir, hostId: host.id })
    .returning()
    .get();

  const file = db
    .insert(schema.file)
    .values({
      name: options.fileName,
      extension: options.extension,
      pathId: pathRecord.id,
      type: options.type ?? 'image',
    })
    .returning()
    .get();

  const mediaItem = db
    .insert(schema.mediaItem)
    .values({
      name: options.fileName,
      type: options.type ?? 'Photo',
    })
    .returning()
    .get();

  db.insert(schema.mediaItemFile)
    .values({ mediaItemId: mediaItem.id, fileId: file.id, isPrimary: true })
    .run();

  const ext = options.extension ? `.${options.extension}` : '';
  const filePath = join(options.dir, `${options.fileName}${ext}`);
  writeFileSync(filePath, randomBytes(128));

  if (options.createThumbnails) {
    const thumbDir = join(options.dir, '.thumbnails');
    mkdirSync(thumbDir, { recursive: true });
    for (const width of options.createThumbnails) {
      const thumbPath = getThumbnailPath(filePath, width);
      writeFileSync(thumbPath, randomBytes(64));
    }
  }

  return { mediaItemId: mediaItem.id, filePath };
}

describe('thumbnails routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;
  let tmpDir: string;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  beforeEach(() => {
    tmpDir = uniqueTmpDir();
  });

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /thumbnails/:id', () => {
    it('returns available thumbnail widths', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo',
        extension: 'jpg',
        createThumbnails: [150, 300, 640],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/thumbnails/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { widths: number[] };
      expect(body.widths).toEqual([150, 300, 640]);
    });

    it('returns empty widths when no thumbnails exist', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/thumbnails/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { widths: number[] };
      expect(body.widths).toEqual([]);
    });

    it('returns 404 when the media item does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/thumbnails/99999',
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
        url: '/thumbnails/abc',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /thumbnails/:id version redirect', () => {
    it('redirects with 301 when v param does not match db_date', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const dbDate = db
        .select({ value: schema.setting.value })
        .from(schema.setting)
        .where(eq(schema.setting.key, 'db_date'))
        .get();

      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo',
        extension: 'jpg',
        createThumbnails: [300],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/thumbnails/${mediaItemId}?v=stale&db=stale`,
      });

      expect(response.statusCode).toBe(301);
      const loc = new URL(response.headers.location!, 'http://localhost');
      expect(loc.pathname).toBe(`/thumbnails/${mediaItemId}`);
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

      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo',
        extension: 'jpg',
        createThumbnails: [300],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/thumbnails/${mediaItemId}?v=${dbDate!.value}&db=${dbDate!.value}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { widths: number[] };
      expect(body.widths).toEqual([300]);
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

      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/thumbnails/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
