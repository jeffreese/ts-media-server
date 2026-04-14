import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import { FileIndex, type FileIndexDeps } from '../../src/services/file-index.js';
import { NotificationService } from '../../src/services/notification.js';
import { createApp, type App } from '../../src/server/app.js';
import * as schema from '../../src/db/schema.js';
import type { Config } from '../../src/config/schema.js';
import type { FFmpeg } from '../../src/utils/ffmpeg.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const dir = join(tmpdir(), `integration-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function writeTestJpeg(
  dir: string,
  name: string,
  width: number,
  height: number,
): Promise<string> {
  const filePath = join(dir, name);
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 64, b: 32 } },
  })
    .withMetadata({
      exif: {
        IFD0: {
          ImageWidth: String(width),
          ImageLength: String(height),
        },
      },
    })
    .jpeg()
    .toBuffer();
  await writeFile(filePath, buf);
  return filePath;
}

function createMockLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => createMockLogger(),
    level: 'silent',
  } as unknown as Logger;
}

function createMockFFmpeg() {
  return {
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    validate: async () => {},
    createJPEG: async () => {},
    createMP4: async () => {},
    getMetadata: async () => ({
      date: undefined,
      width: undefined,
      height: undefined,
      duration: undefined,
      frameRate: undefined,
    }),
    getDuration: async () => 0,
    isMovie: () => false,
    getSupportedExtensions: () => [],
  } as unknown as FFmpeg;
}

// ---------------------------------------------------------------------------
// Integration test: index → serve → browse
// ---------------------------------------------------------------------------

describe('integration: index → serve → browse', () => {
  let client: DatabaseClient;
  let db: BetterSQLite3Database<typeof schema>;
  let app: App;
  let tmpDir: string;

  beforeAll(async () => {
    // 1. Set up temp directory with two subdirectories of images
    tmpDir = uniqueTmpDir();
    const vacation = join(tmpDir, 'photos', 'vacation');
    const family = join(tmpDir, 'photos', 'family');
    mkdirSync(vacation, { recursive: true });
    mkdirSync(family, { recursive: true });

    await writeTestJpeg(vacation, 'beach.jpg', 800, 600);
    await writeTestJpeg(vacation, 'sunset.jpg', 1024, 768);
    await writeTestJpeg(family, 'portrait.jpg', 600, 800);

    // 2. Set up database
    client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    runMigrations(client);
    seedDatabase(client);
    db = drizzle(client.db, { schema });

    // 3. Run the indexing pipeline
    const notifications = new NotificationService();
    const deps: FileIndexDeps = {
      db,
      ffmpeg: createMockFFmpeg(),
      notifications,
      logger: createMockLogger(),
    };
    const fileIndex = new FileIndex(deps);
    await fileIndex.addDirectory({
      directory: join(tmpDir, 'photos'),
      concurrency: 1,
    });

    // 4. Start the server
    app = await createApp({
      config: makeConfig(),
      db: client.db,
      loggerOptions,
      notificationService: notifications,
    });
    await app.server.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    client?.db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Verify indexing produced the expected database state
  // -------------------------------------------------------------------------

  it('indexed all three images as media items', () => {
    const items = db.select().from(schema.mediaItem).all();
    expect(items).toHaveLength(3);
  });

  it('created file records for each image', () => {
    const files = db.select().from(schema.file).all();
    expect(files).toHaveLength(3);
    const extensions = files.map((f) => f.extension);
    expect(extensions.every((ext) => ext === 'jpg')).toBe(true);
  });

  it('created a folder hierarchy mirroring the directory structure', () => {
    const folders = db.select().from(schema.folder).all();
    const names = folders.map((f) => f.name).sort();
    expect(names).toContain('photos');
    expect(names).toContain('vacation');
    expect(names).toContain('family');
  });

  it('linked media items to folders via folder_entry records', () => {
    const entries = db.select().from(schema.folderEntry).all();
    expect(entries).toHaveLength(3);
  });

  it('computed perceptual hashes for all items', () => {
    const items = db.select().from(schema.mediaItem).all();
    for (const item of items) {
      expect(item.hash).toBeTruthy();
      expect(typeof item.hash).toBe('string');
    }
  });

  // -------------------------------------------------------------------------
  // Browse folder hierarchy via /index routes
  // -------------------------------------------------------------------------

  it('lists the root folder via GET /index', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/index' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.folders.length).toBeGreaterThanOrEqual(1);
    const rootFolder = body.folders.find(
      (f: { name: string }) => f.name === 'photos',
    );
    expect(rootFolder).toBeDefined();
  });

  it('navigates into the photos folder and sees subfolders', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.path).toBe('/photos');
    const folderNames = body.folders
      .map((f: { name: string }) => f.name)
      .sort();
    expect(folderNames).toContain('family');
    expect(folderNames).toContain('vacation');
    expect(body.items).toHaveLength(0);
  });

  it('navigates into vacation/ and sees two media items', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos/vacation',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items).toHaveLength(2);
    const names = body.items.map((i: { name: string }) => i.name).sort();
    expect(names).toEqual(['beach', 'sunset']);
  });

  it('navigates into family/ and sees one media item', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos/family',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('portrait');
  });

  it('recursive listing returns all items from all subfolders', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos?recursive=true',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items).toHaveLength(3);
    expect(body.folders).toHaveLength(2);
  });

  it('returns 404 for a non-existent folder path', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos/nonexistent',
    });
    expect(response.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Serve images via /image/:id
  // -------------------------------------------------------------------------

  it('serves an indexed image by media item ID', async () => {
    const items = db.select().from(schema.mediaItem).all();
    const beachItem = items.find((i) => i.name === 'beach');
    expect(beachItem).toBeDefined();

    const response = await app.server.inject({
      method: 'GET',
      url: `/image/${beachItem!.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it('serves a thumbnail when width is requested', async () => {
    const items = db.select().from(schema.mediaItem).all();
    const beachItem = items.find((i) => i.name === 'beach');
    expect(beachItem).toBeDefined();

    const response = await app.server.inject({
      method: 'GET',
      url: `/image/${beachItem!.id}?width=300`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');

    const meta = await sharp(response.rawPayload).metadata();
    expect(meta.width).toBeLessThanOrEqual(300);
  });

  it('returns 404 for a non-existent media item ID', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/image/99999',
    });
    expect(response.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Retrieve media item details via /mediaItem/:id
  // -------------------------------------------------------------------------

  it('returns media item details by ID', async () => {
    const items = db.select().from(schema.mediaItem).all();
    const sunsetItem = items.find((i) => i.name === 'sunset');
    expect(sunsetItem).toBeDefined();

    const response = await app.server.inject({
      method: 'GET',
      url: `/mediaItem/${sunsetItem!.id}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(sunsetItem!.id);
    expect(body.name).toBe('sunset');
    expect(body.type).toBe('image');
  });

  it('returns media item with dimension info from metadata', async () => {
    const items = db.select().from(schema.mediaItem).all();
    const beachItem = items.find((i) => i.name === 'beach');
    expect(beachItem).toBeDefined();

    const response = await app.server.inject({
      method: 'GET',
      url: `/mediaItem/${beachItem!.id}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.info).toBeDefined();
    const info = typeof body.info === 'string' ? JSON.parse(body.info) : body.info;
    expect(info.dimensions).toBeDefined();
    expect(info.dimensions.width).toBe(800);
    expect(info.dimensions.height).toBe(600);
  });

  // -------------------------------------------------------------------------
  // Thumbnail listing via /thumbnails/:id
  // -------------------------------------------------------------------------

  it('lists available thumbnails for an indexed image', async () => {
    const items = db.select().from(schema.mediaItem).all();
    const beachItem = items.find((i) => i.name === 'beach');
    expect(beachItem).toBeDefined();

    const response = await app.server.inject({
      method: 'GET',
      url: `/thumbnails/${beachItem!.id}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.widths).toBeDefined();
    expect(body.widths.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Pagination on browse
  // -------------------------------------------------------------------------

  it('paginates folder contents', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/index/photos/vacation?limit=1&offset=0',
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(2);

    const page2 = await app.server.inject({
      method: 'GET',
      url: '/index/photos/vacation?limit=1&offset=1',
    });
    const body2 = page2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].name).not.toBe(body.items[0].name);
  });
});
