import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';
import { FFmpeg } from '../../src/utils/ffmpeg.js';
import { createLogger } from '../../src/utils/logger.js';
import { createMediaFilter } from '../../src/utils/file.js';
import { NotificationService } from '../../src/services/notification.js';
import { FileIndex } from '../../src/services/file-index.js';
import { deleteThumbnails } from '../../src/services/thumbnail.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'delete-test-'));
}

function createTestDb(dir: string): { client: DatabaseClient; db: ReturnType<typeof drizzle<typeof schema>> } {
  const dbPath = join(dir, 'test.sqlite');
  const client = createDatabaseClient({ path: dbPath, enableSpatialite: false });
  runMigrations(client);
  seedDatabase(client);
  const db = drizzle(client.db, { schema });
  return { client, db };
}

describe('delete thumbnails command', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('deletes .thumbnails directories recursively', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const thumbDir1 = join(dir, '.thumbnails');
    mkdirSync(thumbDir1);
    writeFileSync(join(thumbDir1, 'test_150.jpg'), Buffer.alloc(50));

    const subdir = join(dir, 'subdir');
    mkdirSync(subdir);
    const thumbDir2 = join(subdir, '.thumbnails');
    mkdirSync(thumbDir2);
    writeFileSync(join(thumbDir2, 'test_300.jpg'), Buffer.alloc(50));

    const deleted = await deleteThumbnails(dir);

    expect(deleted).toBe(2);
    expect(existsSync(thumbDir1)).toBe(false);
    expect(existsSync(thumbDir2)).toBe(false);
  });

  it('returns 0 when no .thumbnails directories exist', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const deleted = await deleteThumbnails(dir);
    expect(deleted).toBe(0);
  });

  it('handles non-existent directory gracefully', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const deleted = await deleteThumbnails(join(dir, 'does-not-exist'));
    expect(deleted).toBe(0);
  });
});

describe('delete orphans command', () => {
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

  it('removes orphaned file records when files are deleted from disk', async () => {
    const mediaDir = makeTempDir();
    tempDirs.push(mediaDir);
    const dbDir = makeTempDir();
    tempDirs.push(dbDir);

    writeFileSync(join(mediaDir, 'photo.jpg'), Buffer.alloc(100, 0xFF));

    const { client, db } = createTestDb(dbDir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();
    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({ db, ffmpeg, notifications, logger });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const filesBefore = db.select().from(schema.file).all();
    expect(filesBefore.length).toBeGreaterThanOrEqual(1);

    rmSync(join(mediaDir, 'photo.jpg'));

    const result = await fileIndex.deleteOrphans();

    expect(result.files).toBeGreaterThanOrEqual(1);

    const filesAfter = db.select().from(schema.file).all();
    expect(filesAfter.length).toBe(0);
  });

  it('returns zero counts when there are no orphans', async () => {
    const mediaDir = makeTempDir();
    tempDirs.push(mediaDir);
    const dbDir = makeTempDir();
    tempDirs.push(dbDir);

    writeFileSync(join(mediaDir, 'photo.jpg'), Buffer.alloc(100, 0xFF));

    const { client, db } = createTestDb(dbDir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();
    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({ db, ffmpeg, notifications, logger });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const result = await fileIndex.deleteOrphans();

    expect(result.files).toBe(0);
    expect(result.mediaItems).toBe(0);
    expect(result.paths).toBe(0);
  });

  it('cleans up media items left with no files', async () => {
    const mediaDir = makeTempDir();
    tempDirs.push(mediaDir);
    const dbDir = makeTempDir();
    tempDirs.push(dbDir);

    writeFileSync(join(mediaDir, 'single.jpg'), Buffer.alloc(100, 0xFF));

    const { client, db } = createTestDb(dbDir);
    clients.push(client);

    const logger = createLogger({ level: 'silent' });
    const notifications = new NotificationService();
    const ffmpeg = new FFmpeg();
    vi.spyOn(ffmpeg, 'validate').mockResolvedValue();

    const fileIndex = new FileIndex({ db, ffmpeg, notifications, logger });

    await fileIndex.addDirectory({
      directory: mediaDir,
      fileFilter: createMediaFilter(),
      concurrency: 1,
    });

    const mediaItemsBefore = db.select().from(schema.mediaItem).all();
    expect(mediaItemsBefore.length).toBe(1);

    rmSync(join(mediaDir, 'single.jpg'));

    const result = await fileIndex.deleteOrphans();

    expect(result.files).toBe(1);
    expect(result.mediaItems).toBe(1);

    const mediaItemsAfter = db.select().from(schema.mediaItem).all();
    expect(mediaItemsAfter.length).toBe(0);
  });
});
