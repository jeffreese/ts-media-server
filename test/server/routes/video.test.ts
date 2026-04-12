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
  const dir = join(tmpdir(), `video-route-test-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface SeedVideoOptions {
  dir: string;
  fileName: string;
  /** Primary file extension in DB / on disk (e.g. mov, mp4) */
  primaryExtension: string;
  /** Bytes written to the served `.mp4` path (indexer sidecar) */
  mp4Content?: Buffer;
}

/**
 * Seed a video media item: primary file row + optional primary file on disk,
 * and the MP4 path `{name}.mp4` that `/video/:id` serves.
 */
function seedVideoMediaItem(
  client: DatabaseClient,
  options: SeedVideoOptions,
): { mediaItemId: number; mp4Path: string; mp4Written: Buffer } {
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
      extension: options.primaryExtension,
      pathId: pathRecord.id,
      type: 'video',
    })
    .returning()
    .get();

  const mediaItem = db
    .insert(schema.mediaItem)
    .values({
      name: options.fileName,
      type: 'video',
    })
    .returning()
    .get();

  db.insert(schema.mediaItemFile)
    .values({ mediaItemId: mediaItem.id, fileId: file.id, isPrimary: true })
    .run();

  const primaryExt = options.primaryExtension ? `.${options.primaryExtension}` : '';
  const primaryPath = join(options.dir, `${options.fileName}${primaryExt}`);
  writeFileSync(primaryPath, randomBytes(32));

  const mp4Written = options.mp4Content ?? randomBytes(256);
  const mp4Path = join(options.dir, `${options.fileName}.mp4`);
  writeFileSync(mp4Path, mp4Written);

  return { mediaItemId: mediaItem.id, mp4Path, mp4Written };
}

describe('video routes', () => {
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

  describe('GET /video/:id', () => {
    it('streams the MP4 for a video item with mp4 primary', async () => {
      const client = setupDb();
      const { mediaItemId, mp4Written } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'clip',
        primaryExtension: 'mp4',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('video/mp4');
      expect(response.headers['last-modified']).toBeDefined();
      expect(response.headers['cache-control']).toContain('public');
      expect(response.rawPayload).toEqual(mp4Written);
    });

    it('streams sidecar MP4 when primary is a non-mp4 video', async () => {
      const client = setupDb();
      const mp4Bytes = Buffer.from('sidecar-mp4-data');
      const { mediaItemId, mp4Written } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'movie',
        primaryExtension: 'mov',
        mp4Content: mp4Bytes,
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(mp4Written);
    });

    it('returns 404 for a non-existent media item', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/video/99999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Media item not found');
    });

    it('returns 404 when media item is not a video', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      const host = db.insert(schema.host).values({ name: 'test' }).returning().get();
      const pathRecord = db
        .insert(schema.path)
        .values({ dir: tmpDir, hostId: host.id })
        .returning()
        .get();

      const file = db
        .insert(schema.file)
        .values({
          name: 'pic',
          extension: 'jpg',
          pathId: pathRecord.id,
          type: 'image',
        })
        .returning()
        .get();

      const mediaItem = db
        .insert(schema.mediaItem)
        .values({ name: 'pic', type: 'image' })
        .returning()
        .get();

      db.insert(schema.mediaItemFile)
        .values({ mediaItemId: mediaItem.id, fileId: file.id, isPrimary: true })
        .run();

      writeFileSync(join(tmpDir, 'pic.jpg'), randomBytes(64));
      writeFileSync(join(tmpDir, 'pic.mp4'), randomBytes(64));

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItem.id}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Not a video');
    });

    it('returns 404 when MP4 is missing on disk', async () => {
      const client = setupDb();
      const { mediaItemId, mp4Path } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'novid',
        primaryExtension: 'mp4',
      });

      rmSync(mp4Path);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('MP4');
    });

    it('returns 400 for an invalid ID', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/video/abc',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('version redirect', () => {
    it('redirects with 301 when v param does not match db_date', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const dbDate = db
        .select({ value: schema.setting.value })
        .from(schema.setting)
        .where(eq(schema.setting.key, 'db_date'))
        .get();

      const { mediaItemId } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'versioned',
        primaryExtension: 'mp4',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}?v=old-version&db=old-version`,
      });

      expect(response.statusCode).toBe(301);
      const loc = new URL(response.headers.location!, 'http://localhost');
      expect(loc.pathname).toBe(`/video/${mediaItemId}`);
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

      const { mediaItemId } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'fresh',
        primaryExtension: 'mp4',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}?v=${dbDate!.value}&db=${dbDate!.value}`,
      });

      expect(response.statusCode).toBe(200);
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

      const { mediaItemId } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'secure',
        primaryExtension: 'mp4',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}`,
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

      const { mediaItemId } = seedVideoMediaItem(client, {
        dir: tmpDir,
        fileName: 'tokenok',
        primaryExtension: 'mp4',
      });

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: 1 });

      const response = await app.server.inject({
        method: 'GET',
        url: `/video/${mediaItemId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
