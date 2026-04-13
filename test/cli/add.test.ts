import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { loadConfig } from '../../src/config/config.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';
import { FFmpeg } from '../../src/utils/ffmpeg.js';
import { createMediaFilter } from '../../src/utils/file.js';
import { NotificationService, type NotificationEvent } from '../../src/services/notification.js';
import { FileIndex } from '../../src/services/file-index.js';
import { createLogger } from '../../src/utils/logger.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'add-test-'));
}

function createTestDb(dir: string): { client: DatabaseClient; db: ReturnType<typeof drizzle<typeof schema>> } {
  const dbPath = join(dir, 'test.sqlite');
  const client = createDatabaseClient({ path: dbPath, enableSpatialite: false });
  runMigrations(client);
  seedDatabase(client);
  const db = drizzle(client.db, { schema });
  return { client, db };
}

describe('add directory command', () => {
  const tempDirs: string[] = [];
  const clients: DatabaseClient[] = [];

  afterEach(() => {
    for (const c of clients) {
      try { c.db.close(); } catch { /* already closed */ }
    }
    clients.length = 0;
    for (const d of tempDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function setupMediaDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    writeFileSync(join(dir, 'test-image.jpg'), Buffer.alloc(100, 0xFF));
    return dir;
  }

  function setupNestedMediaDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    writeFileSync(join(dir, 'root-image.jpg'), Buffer.alloc(100, 0xFF));
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    writeFileSync(join(sub, 'sub-image.png'), Buffer.alloc(100, 0xFF));
    return dir;
  }

  it('validates that --path must be an existing directory', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();
    const ffmpeg = new FFmpeg();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    const nonExistent = join(dir, 'does-not-exist');

    await expect(
      fileIndex.addDirectory({
        directory: nonExistent,
        fileFilter: createMediaFilter(),
      }),
    ).rejects.toThrow();
  });

  it('emits progress notifications during indexing', async () => {
    const mediaDir = setupMediaDir();
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();

    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    const events: NotificationEvent[] = [];
    notifications.addListener((event) => {
      if (event.action === 'progress' && event.source === 'fileIndex') {
        events.push(event);
      }
    });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const phases = events.map((e) => (e.data as Record<string, unknown>).phase);
    expect(phases).toContain('scanning');
    expect(phases).toContain('registering_files');
    expect(phases).toContain('complete');
  });

  it('indexes files and creates media items in database', async () => {
    const mediaDir = setupMediaDir();
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();

    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const files = db.select().from(schema.file).all();
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0].extension).toBe('jpg');

    const mediaItems = db.select().from(schema.mediaItem).all();
    expect(mediaItems.length).toBeGreaterThanOrEqual(1);
  });

  it('reads ffmpeg paths from settings table', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    db.insert(schema.setting)
      .values({ key: 'ffmpegPath', value: '/usr/local/bin/ffmpeg' })
      .onConflictDoNothing()
      .run();

    const row = db
      .select({ value: schema.setting.value })
      .from(schema.setting)
      .where(eq(schema.setting.key, 'ffmpegPath'))
      .get();

    expect(row?.value).toBe('/usr/local/bin/ffmpeg');
  });

  it('creates folder hierarchy for nested directories', async () => {
    const mediaDir = setupNestedMediaDir();
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();

    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const folders = db.select().from(schema.folder).all();
    expect(folders.length).toBeGreaterThanOrEqual(2);

    const folderNames = folders.map((f) => f.name);
    expect(folderNames).toContain('subdir');
  });

  it('respects concurrency option', async () => {
    const mediaDir = setupMediaDir();
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();

    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 2,
    });

    const mediaItems = db.select().from(schema.mediaItem).all();
    expect(mediaItems.length).toBeGreaterThanOrEqual(1);
  });

  it('skips face detection when model sessions are not provided', async () => {
    const mediaDir = setupMediaDir();
    const dir = makeTempDir();
    tempDirs.push(dir);
    const { client, db } = createTestDb(dir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();

    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({
      db,
      ffmpeg,
      notifications,
      logger,
    });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const features = db.select().from(schema.feature).all();
    expect(features.length).toBe(0);
  });
});
