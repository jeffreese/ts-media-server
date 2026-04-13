import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { FileOperations } from '../../src/services/file-operations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `file-ops-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestFile(dir: string, name: string, content?: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content ?? `test-content-${name}-${randomUUID()}`);
  return filePath;
}

function setupDb(): {
  client: DatabaseClient;
  db: BetterSQLite3Database<typeof schema>;
} {
  const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
  runMigrations(client);
  return { client, db: drizzle(client.db, { schema }) };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
  } as any;
}

function insertHost(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.host)
    .values({ name: 'localhost' })
    .returning({ id: schema.host.id })
    .get().id;
}

function insertPath(
  db: BetterSQLite3Database<typeof schema>,
  dir: string,
  hostId: number,
): number {
  return db
    .insert(schema.path)
    .values({ dir, hostId })
    .returning({ id: schema.path.id })
    .get().id;
}

function insertFile(
  db: BetterSQLite3Database<typeof schema>,
  name: string,
  extension: string,
  pathId: number,
): number {
  return db
    .insert(schema.file)
    .values({ name, extension, pathId, type: 'image' })
    .returning({ id: schema.file.id })
    .get().id;
}

function insertMediaItem(
  db: BetterSQLite3Database<typeof schema>,
  name: string,
  startDate?: string,
): number {
  return db
    .insert(schema.mediaItem)
    .values({ name, type: 'image', startDate })
    .returning({ id: schema.mediaItem.id })
    .get().id;
}

function linkFileToMediaItem(
  db: BetterSQLite3Database<typeof schema>,
  mediaItemId: number,
  fileId: number,
  isPrimary = true,
): void {
  db.insert(schema.mediaItemFile)
    .values({ mediaItemId, fileId, isPrimary })
    .run();
}

/**
 * Set up a media item with a file record and actual file on disk.
 * Reuses an existing host if one exists.
 */
function setupMediaItemInDir(
  db: BetterSQLite3Database<typeof schema>,
  dir: string,
  hostId: number,
  opts: { name: string; ext: string; date?: string; content?: string },
): { mediaItemId: number; fileId: number } {
  const existingPath = db
    .select({ id: schema.path.id })
    .from(schema.path)
    .where(eq(schema.path.dir, dir))
    .get();

  const pathId = existingPath?.id ?? insertPath(db, dir, hostId);
  const fileId = insertFile(db, opts.name, opts.ext, pathId);
  const mediaItemId = insertMediaItem(db, opts.name, opts.date);
  linkFileToMediaItem(db, mediaItemId, fileId);

  createTestFile(dir, `${opts.name}.${opts.ext}`, opts.content);

  return { mediaItemId, fileId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileOperations', () => {
  let client: DatabaseClient;
  let db: BetterSQLite3Database<typeof schema>;
  let tmpDir: string;

  beforeEach(() => {
    ({ client, db } = setupDb());
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    client.db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // moveMediaItem
  // -------------------------------------------------------------------------

  describe('moveMediaItem', () => {
    it('copies files to the destination and deletes originals', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const { mediaItemId, filePath } = (() => {
        const pathId = insertPath(db, sourceDir, hostId);
        const fileId = insertFile(db, 'photo', 'jpg', pathId);
        const mediaItemId = insertMediaItem(db, 'photo');
        linkFileToMediaItem(db, mediaItemId, fileId);
        const filePath = createTestFile(sourceDir, 'photo.jpg', 'jpeg-data');
        return { mediaItemId, filePath };
      })();

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.moveMediaItem(mediaItemId, destDir);

      expect(result.filesMoved).toBe(1);
      expect(existsSync(join(destDir, 'photo.jpg'))).toBe(true);
      expect(existsSync(filePath)).toBe(false);
      expect(readFileSync(join(destDir, 'photo.jpg'), 'utf-8')).toBe('jpeg-data');
    });

    it('verifies SHA1 checksums during copy', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const content = 'checksum-test-content-' + randomUUID();
      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const fileId = insertFile(db, 'verified', 'png', pathId);
      const mediaItemId = insertMediaItem(db, 'verified');
      linkFileToMediaItem(db, mediaItemId, fileId);
      createTestFile(sourceDir, 'verified.png', content);

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.moveMediaItem(mediaItemId, destDir);

      expect(result.filesMoved).toBe(1);
      expect(readFileSync(join(destDir, 'verified.png'), 'utf-8')).toBe(content);
    });

    it('updates database path records after move', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const fileId = insertFile(db, 'moved', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'moved');
      linkFileToMediaItem(db, mediaItemId, fileId);
      createTestFile(sourceDir, 'moved.jpg');

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.moveMediaItem(mediaItemId, destDir);

      const fileRecord = db
        .select({ pathId: schema.file.pathId })
        .from(schema.file)
        .where(eq(schema.file.id, fileId))
        .get()!;

      const pathRecord = db
        .select({ dir: schema.path.dir })
        .from(schema.path)
        .where(eq(schema.path.id, fileRecord.pathId))
        .get()!;

      expect(pathRecord.dir).toBe(destDir);
    });

    it('moves thumbnails to new .thumbnails directory', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const fileId = insertFile(db, 'thumb_test', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'thumb_test');
      linkFileToMediaItem(db, mediaItemId, fileId);
      createTestFile(sourceDir, 'thumb_test.jpg');

      const sourceThumbDir = join(sourceDir, '.thumbnails');
      mkdirSync(sourceThumbDir, { recursive: true });
      writeFileSync(join(sourceThumbDir, 'thumb_test_300.jpg'), 'thumb-300');
      writeFileSync(join(sourceThumbDir, 'thumb_test_150.jpg'), 'thumb-150');

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.moveMediaItem(mediaItemId, destDir);

      expect(result.thumbnailsMoved).toBe(2);
      expect(existsSync(join(destDir, '.thumbnails', 'thumb_test_300.jpg'))).toBe(true);
      expect(existsSync(join(destDir, '.thumbnails', 'thumb_test_150.jpg'))).toBe(true);
    });

    it('rolls back copies when a file fails', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const file1Id = insertFile(db, 'good', 'jpg', pathId);
      const file2Id = insertFile(db, 'missing', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'multi');
      linkFileToMediaItem(db, mediaItemId, file1Id, true);
      linkFileToMediaItem(db, mediaItemId, file2Id, false);

      createTestFile(sourceDir, 'good.jpg', 'good-content');
      // Don't create missing.jpg

      const ops = new FileOperations({ db, logger: createMockLogger() });

      await expect(ops.moveMediaItem(mediaItemId, destDir)).rejects.toThrow(
        'Source file not found',
      );

      expect(existsSync(join(destDir, 'good.jpg'))).toBe(false);
      expect(existsSync(join(sourceDir, 'good.jpg'))).toBe(true);
    });

    it('handles multiple files per media item', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const file1Id = insertFile(db, 'IMG_001', 'heic', pathId);
      const file2Id = insertFile(db, 'IMG_001', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'IMG_001');
      linkFileToMediaItem(db, mediaItemId, file1Id, true);
      linkFileToMediaItem(db, mediaItemId, file2Id, false);

      createTestFile(sourceDir, 'IMG_001.heic', 'heic-data');
      createTestFile(sourceDir, 'IMG_001.jpg', 'jpg-data');

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.moveMediaItem(mediaItemId, destDir);

      expect(result.filesMoved).toBe(2);
      expect(existsSync(join(destDir, 'IMG_001.heic'))).toBe(true);
      expect(existsSync(join(destDir, 'IMG_001.jpg'))).toBe(true);
      expect(existsSync(join(sourceDir, 'IMG_001.heic'))).toBe(false);
      expect(existsSync(join(sourceDir, 'IMG_001.jpg'))).toBe(false);
    });

    it('throws for a media item with no files', async () => {
      const mediaItemId = insertMediaItem(db, 'empty');
      const destDir = join(tmpDir, 'dest');

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await expect(ops.moveMediaItem(mediaItemId, destDir)).rejects.toThrow(
        'No files found',
      );
    });

    it('creates the output directory if it does not exist', async () => {
      const sourceDir = join(tmpDir, 'source');
      const destDir = join(tmpDir, 'nested', 'deep', 'dest');
      mkdirSync(sourceDir, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, sourceDir, hostId);
      const fileId = insertFile(db, 'nested', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'nested');
      linkFileToMediaItem(db, mediaItemId, fileId);
      createTestFile(sourceDir, 'nested.jpg');

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.moveMediaItem(mediaItemId, destDir);

      expect(existsSync(join(destDir, 'nested.jpg'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // mergeDirectories
  // -------------------------------------------------------------------------

  describe('mergeDirectories', () => {
    it('combines media items from multiple directories', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const dir2 = join(tmpDir, 'dir2');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      const hostId = insertHost(db);

      setupMediaItemInDir(db, dir1, hostId, {
        name: 'photo1',
        ext: 'jpg',
        date: '2024-06-15T14:30:00',
      });
      setupMediaItemInDir(db, dir2, hostId, {
        name: 'photo2',
        ext: 'jpg',
        date: '2024-07-20T09:15:00',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.mergeDirectories([dir1, dir2], outDir);

      expect(result.moved).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      const outFiles = readdirSync(outDir).filter((f) => !f.startsWith('.'));
      expect(outFiles).toHaveLength(2);
    });

    it('renames files using date-based naming', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);
      setupMediaItemInDir(db, dir1, hostId, {
        name: 'original_name',
        ext: 'jpg',
        date: '2024-06-15T14:30:00',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.mergeDirectories([dir1], outDir);

      const outFiles = readdirSync(outDir).filter((f) => !f.startsWith('.'));
      expect(outFiles).toHaveLength(1);
      expect(outFiles[0]).toBe('IMG_20240615_143000.jpg');
    });

    it('handles duplicate filenames with suffix', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const dir2 = join(tmpDir, 'dir2');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      const hostId = insertHost(db);

      setupMediaItemInDir(db, dir1, hostId, {
        name: 'a',
        ext: 'jpg',
        date: '2024-06-15T14:30:00',
      });
      setupMediaItemInDir(db, dir2, hostId, {
        name: 'b',
        ext: 'jpg',
        date: '2024-06-15T14:30:00',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.mergeDirectories([dir1, dir2], outDir);

      expect(result.moved).toBe(2);
      const outFiles = readdirSync(outDir).filter((f) => !f.startsWith('.')).sort();
      expect(outFiles).toContain('IMG_20240615_143000.jpg');
      expect(outFiles).toContain('IMG_20240615_143000(2).jpg');
    });

    it('skips media items without dates', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);

      setupMediaItemInDir(db, dir1, hostId, {
        name: 'dated',
        ext: 'jpg',
        date: '2024-06-15T14:30:00',
      });
      setupMediaItemInDir(db, dir1, hostId, {
        name: 'undated',
        ext: 'jpg',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.mergeDirectories([dir1], outDir);

      expect(result.moved).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('verifies integrity with SHA1 checksums', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);
      const content = 'integrity-check-content-' + randomUUID();
      setupMediaItemInDir(db, dir1, hostId, {
        name: 'verified',
        ext: 'jpg',
        date: '2024-01-01T00:00:00',
        content,
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.mergeDirectories([dir1], outDir);

      const outFiles = readdirSync(outDir).filter((f) => !f.startsWith('.'));
      expect(outFiles).toHaveLength(1);
      expect(readFileSync(join(outDir, outFiles[0]), 'utf-8')).toBe(content);
    });

    it('updates file records with new names and paths', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);
      const { fileId } = setupMediaItemInDir(db, dir1, hostId, {
        name: 'old_name',
        ext: 'jpg',
        date: '2024-03-10T12:00:00',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.mergeDirectories([dir1], outDir);

      const updatedFile = db
        .select({ name: schema.file.name, pathId: schema.file.pathId })
        .from(schema.file)
        .where(eq(schema.file.id, fileId))
        .get()!;

      expect(updatedFile.name).toBe('IMG_20240310_120000');

      const updatedPath = db
        .select({ dir: schema.path.dir })
        .from(schema.path)
        .where(eq(schema.path.id, updatedFile.pathId))
        .get()!;

      expect(updatedPath.dir).toBe(outDir);
    });

    it('creates output directory if it does not exist', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'nested', 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);
      setupMediaItemInDir(db, dir1, hostId, {
        name: 'test',
        ext: 'jpg',
        date: '2024-01-01T00:00:00',
      });

      const ops = new FileOperations({ db, logger: createMockLogger() });
      await ops.mergeDirectories([dir1], outDir);

      expect(existsSync(outDir)).toBe(true);
    });

    it('returns errors for items that fail to move', async () => {
      const dir1 = join(tmpDir, 'dir1');
      const outDir = join(tmpDir, 'output');
      mkdirSync(dir1, { recursive: true });

      const hostId = insertHost(db);
      const pathId = insertPath(db, dir1, hostId);
      const fileId = insertFile(db, 'ghost', 'jpg', pathId);
      const mediaItemId = insertMediaItem(db, 'ghost', '2024-01-01T00:00:00');
      linkFileToMediaItem(db, mediaItemId, fileId);
      // Don't create the file on disk

      const ops = new FileOperations({ db, logger: createMockLogger() });
      const result = await ops.mergeDirectories([dir1], outDir);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].mediaItemId).toBe(mediaItemId);
      expect(result.errors[0].error).toContain('Source file not found');
    });
  });
});
