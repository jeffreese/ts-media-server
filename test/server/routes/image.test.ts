import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, normalize } from 'node:path';
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
import { normalizePath } from '../../../src/utils/file.js';
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
  const dir = join(tmpdir(), `image-route-test-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Seed a media item with a primary file pointing at a real file on disk.
 * Returns the media item ID and the path to the file.
 */
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

describe('image routes', () => {
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

  // ---------------------------------------------------------------------------
  // Basic serving
  // ---------------------------------------------------------------------------

  describe('GET /image/:id', () => {
    it('serves the original image file', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo1',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['last-modified']).toBeDefined();
      expect(response.headers['cache-control']).toContain('public');
    });

    it('returns 404 for a non-existent media item', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/image/99999',
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
        url: '/image/abc',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns correct content type for PNG files', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo2',
        extension: 'png',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    it('returns 404 when file is missing from disk', async () => {
      const client = setupDb();
      const { filePath, mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'gone',
        extension: 'jpg',
      });

      rmSync(filePath);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('File not found');
    });
  });

  describe('GET /image (path-based lookup)', () => {
    it('serves the image when dir and file match the primary file', async () => {
      const client = setupDb();
      seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'byPathPhoto',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const dirParam = encodeURIComponent(normalizePath(tmpDir));
      const response = await app.server.inject({
        method: 'GET',
        url: `/image?dir=${dirParam}&file=byPathPhoto.jpg`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
    });

    it('accepts a directory string normalized like the indexer', async () => {
      const client = setupDb();
      const nested = join(tmpDir, 'sub');
      mkdirSync(nested, { recursive: true });
      seedMediaItem(client, {
        dir: nested,
        fileName: 'nested',
        extension: 'png',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const dirWithDots = join(tmpDir, 'sub', '..', 'sub');
      const dirParam = encodeURIComponent(normalizePath(dirWithDots));
      const response = await app.server.inject({
        method: 'GET',
        url: `/image?dir=${dirParam}&file=nested.png`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    it('returns 404 when no file matches the path', async () => {
      const client = setupDb();
      seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'onlyThis',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const dirParam = encodeURIComponent(normalize(tmpDir));
      const response = await app.server.inject({
        method: 'GET',
        url: `/image?dir=${dirParam}&file=missing.jpg`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('not found');
    });

    it('returns 400 when file contains a path separator', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const dirParam = encodeURIComponent(normalize(tmpDir));
      const response = await app.server.inject({
        method: 'GET',
        url: `/image?dir=${dirParam}&file=sub%2Fphoto.jpg`,
      });

      expect(response.statusCode).toBe(400);
    });

    it('redirects with 301 for stale version params while preserving dir and file', async () => {
      const client = setupDb();
      seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'versionedPath',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const dirParam = encodeURIComponent(normalizePath(tmpDir));
      const response = await app.server.inject({
        method: 'GET',
        url: `/image?dir=${dirParam}&file=versionedPath.jpg&v=old&db=old`,
      });

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toContain('dir=');
      expect(response.headers.location).toContain('file=versionedPath.jpg');
    });
  });

  // ---------------------------------------------------------------------------
  // Thumbnail selection
  // ---------------------------------------------------------------------------

  describe('thumbnail selection', () => {
    it('serves a thumbnail when width is requested', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo3',
        extension: 'jpg',
        createThumbnails: [150, 300, 640, 1280, 1920],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?width=300`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
    });

    it('selects the smallest thumbnail >= requested width', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo4',
        extension: 'jpg',
        createThumbnails: [150, 300, 640, 1280, 1920],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?width=200`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
    });

    it('falls back to largest thumbnail when requested width exceeds all tiers', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo5',
        extension: 'jpg',
        createThumbnails: [150, 300],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?width=4000`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/jpeg');
    });

    it('falls back to original when no thumbnails exist', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo6',
        extension: 'png',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?width=300`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    });

    it('supports height query parameter', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo7',
        extension: 'jpg',
        createThumbnails: [300, 640],
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?height=400`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Version-based caching
  // ---------------------------------------------------------------------------

  describe('version redirect', () => {
    it('redirects with 301 when v param does not match db_date', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo8',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?v=old-version&db=old-version`,
      });

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBeDefined();
      expect(response.headers.location).toContain(`/image/${mediaItemId}`);
    });

    it('serves normally when v param matches db_date', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const dbDate = db
        .select({ value: schema.setting.value })
        .from(schema.setting)
        .where(eq(schema.setting.key, 'db_date'))
        .get();

      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo9',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}?v=${dbDate!.value}&db=${dbDate!.value}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('serves normally when no version params are provided', async () => {
      const client = setupDb();
      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo10',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  describe('authentication', () => {
    it('requires authentication when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo11',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/image/1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('succeeds with a valid token when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      const { mediaItemId } = seedMediaItem(client, {
        dir: tmpDir,
        fileName: 'photo12',
        extension: 'jpg',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: 1 });

      const response = await app.server.inject({
        method: 'GET',
        url: `/image/${mediaItemId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
