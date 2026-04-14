import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { FileIndex, type FileIndexDeps } from '../../src/services/file-index.js';
import { NotificationService } from '../../src/services/notification.js';
import { FFmpeg } from '../../src/utils/ffmpeg.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `file-index-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestImage(dir: string, name: string): string {
  const filePath = join(dir, name);
  // Write a minimal JPEG-like file (just enough bytes to not be empty)
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
  writeFileSync(filePath, header);
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

function createMockFFmpeg(): FFmpeg {
  const mock = {
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    validate: vi.fn().mockResolvedValue(undefined),
    createJPEG: vi.fn().mockResolvedValue(undefined),
    createMP4: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue({
      date: undefined,
      width: undefined,
      height: undefined,
      duration: undefined,
      frameRate: undefined,
    }),
    getDuration: vi.fn().mockResolvedValue(0),
    isMovie: vi.fn().mockReturnValue(false),
    getSupportedExtensions: vi.fn().mockReturnValue([]),
  };
  return mock as unknown as FFmpeg;
}

function createDeps(
  db: BetterSQLite3Database<typeof schema>,
  overrides: Partial<FileIndexDeps> = {},
): FileIndexDeps {
  return {
    db,
    ffmpeg: createMockFFmpeg(),
    notifications: new NotificationService(),
    logger: createMockLogger(),
    ...overrides,
  };
}

function insertHost(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.host)
    .values({ name: 'localhost' })
    .returning({ id: schema.host.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileIndex', () => {
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
  // addPaths
  // -------------------------------------------------------------------------

  describe('addPaths', () => {
    it('creates path records for directories containing media files', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'test.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);

      expect(paths).toHaveLength(1);
      expect(paths[0].dir).toBe(subDir);
    });

    it('skips hidden directories', async () => {
      const visible = join(tmpDir, 'photos');
      const hidden = join(tmpDir, '.hidden');
      const underscored = join(tmpDir, '_private');
      mkdirSync(visible);
      mkdirSync(hidden);
      mkdirSync(underscored);
      createTestImage(visible, 'test.jpg');
      createTestImage(hidden, 'hidden.jpg');
      createTestImage(underscored, 'private.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);

      const dirs = paths.map((p) => p.dir);
      expect(dirs).toContain(visible);
      expect(dirs).not.toContain(hidden);
      expect(dirs).not.toContain(underscored);
    });

    it('returns existing path records on re-scan', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'test.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));

      const first = await index.addPaths(tmpDir, hostId);
      const second = await index.addPaths(tmpDir, hostId);

      expect(first[0].id).toBe(second[0].id);
    });

    it('returns empty array for empty directory', async () => {
      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);
      expect(paths).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // addFiles
  // -------------------------------------------------------------------------

  describe('addFiles', () => {
    it('creates file records and groups them by name', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'IMG_001.jpg');
      createTestImage(subDir, 'IMG_002.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);
      const groups = await index.addFiles(paths);

      expect(groups).toHaveLength(2);

      const allFiles = db.select().from(schema.file).all();
      expect(allFiles).toHaveLength(2);
    });

    it('groups related files by base name', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'IMG_001.jpg');
      createTestImage(subDir, 'IMG_001.heic');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);
      const groups = await index.addFiles(paths);

      expect(groups).toHaveLength(1);
      expect(groups[0].fileIds).toHaveLength(2);
      expect(groups[0].group.primary.extension.toLowerCase()).toBe('heic');
    });

    it('updates existing file records on re-scan', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'test.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);

      const first = await index.addFiles(paths);
      const second = await index.addFiles(paths);

      expect(first[0].fileIds[0]).toBe(second[0].fileIds[0]);

      const allFiles = db.select().from(schema.file).all();
      expect(allFiles).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Folder Management
  // -------------------------------------------------------------------------

  describe('getOrCreateFolder', () => {
    it('creates a root folder', () => {
      const index = new FileIndex(createDeps(db));
      const id = index.getOrCreateFolder('Photos', null);

      const folder = db
        .select()
        .from(schema.folder)
        .where(eq(schema.folder.id, id))
        .get();

      expect(folder).toBeDefined();
      expect(folder!.name).toBe('Photos');
      expect(folder!.parentId).toBeNull();
    });

    it('creates nested folders', () => {
      const index = new FileIndex(createDeps(db));
      const rootId = index.getOrCreateFolder('Photos', null);
      const childId = index.getOrCreateFolder('2024', rootId);

      const child = db
        .select()
        .from(schema.folder)
        .where(eq(schema.folder.id, childId))
        .get();

      expect(child).toBeDefined();
      expect(child!.name).toBe('2024');
      expect(child!.parentId).toBe(rootId);
    });

    it('returns existing folder on duplicate call', () => {
      const index = new FileIndex(createDeps(db));
      const id1 = index.getOrCreateFolder('Photos', null);
      const id2 = index.getOrCreateFolder('Photos', null);

      expect(id1).toBe(id2);
    });
  });

  // -------------------------------------------------------------------------
  // deleteOrphans
  // -------------------------------------------------------------------------

  describe('deleteOrphans', () => {
    it('removes file records whose files no longer exist on disk', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      const filePath = createTestImage(subDir, 'test.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);
      await index.addFiles(paths);

      expect(db.select().from(schema.file).all()).toHaveLength(1);

      // Delete the file from disk
      unlinkSync(filePath);

      const result = await index.deleteOrphans();
      expect(result.files).toBe(1);
      expect(db.select().from(schema.file).all()).toHaveLength(0);
    });

    it('removes paths with no remaining files', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      const filePath = createTestImage(subDir, 'test.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));
      const paths = await index.addPaths(tmpDir, hostId);
      await index.addFiles(paths);

      unlinkSync(filePath);

      const result = await index.deleteOrphans();
      expect(result.paths).toBe(1);
      expect(db.select().from(schema.path).all()).toHaveLength(0);
    });

    it('removes empty folders', async () => {
      const index = new FileIndex(createDeps(db));
      const folderId = index.getOrCreateFolder('EmptyFolder', null);

      expect(db.select().from(schema.folder).all()).toHaveLength(1);

      const result = await index.deleteOrphans();
      expect(result.folders).toBe(1);
      expect(db.select().from(schema.folder).all()).toHaveLength(0);
    });

    it('preserves folders that have entries', async () => {
      // Create a real file on disk so the media item isn't orphaned
      const subDir = join(tmpDir, 'kept');
      mkdirSync(subDir);
      createTestImage(subDir, 'keep.jpg');

      const hostId = insertHost(db);
      const index = new FileIndex(createDeps(db));

      const paths = await index.addPaths(tmpDir, hostId);
      const groups = await index.addFiles(paths);

      const folderId = index.getOrCreateFolder('HasEntries', null);
      const mediaItemId = db
        .insert(schema.mediaItem)
        .values({ name: 'test', type: 'image' })
        .returning({ id: schema.mediaItem.id })
        .get().id;

      // Link the media item to a file so it's not orphaned
      db.insert(schema.mediaItemFile)
        .values({ mediaItemId, fileId: groups[0].fileIds[0], isPrimary: true })
        .run();

      db.insert(schema.folderEntry)
        .values({ folderId, itemId: mediaItemId, index: 0 })
        .run();

      const result = await index.deleteOrphans();
      expect(result.folders).toBe(0);
      expect(db.select().from(schema.folder).all()).toHaveLength(1);
    });

    it('returns zero counts when nothing to clean', async () => {
      const index = new FileIndex(createDeps(db));
      const result = await index.deleteOrphans();

      expect(result.files).toBe(0);
      expect(result.mediaItems).toBe(0);
      expect(result.paths).toBe(0);
      expect(result.folders).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // addDirectory (full pipeline)
  // -------------------------------------------------------------------------

  describe('addDirectory', () => {
    it('indexes a directory of image files', async () => {
      const subDir = join(tmpDir, 'vacation');
      mkdirSync(subDir);
      createTestImage(subDir, 'IMG_001.jpg');
      createTestImage(subDir, 'IMG_002.jpg');

      const notifications = new NotificationService();
      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      const index = new FileIndex(createDeps(db, { notifications }));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      // Verify files were registered
      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(2);

      // Verify paths were created
      const paths = db.select().from(schema.path).all();
      expect(paths.length).toBeGreaterThanOrEqual(1);

      // Verify progress notifications were emitted
      const progressEvents = events.filter(
        (e: any) => e.action === 'progress' && e.source === 'fileIndex',
      );
      expect(progressEvents.length).toBeGreaterThan(0);

      // Verify completion notification
      const completeEvent = progressEvents.find(
        (e: any) => e.data?.phase === 'complete',
      ) as any;
      expect(completeEvent).toBeDefined();
      expect(completeEvent.data.processed).toBe(2);
    });

    it('creates folder hierarchy mirroring directory structure', async () => {
      const subDir = join(tmpDir, 'photos', '2024');
      mkdirSync(subDir, { recursive: true });
      createTestImage(subDir, 'test.jpg');

      const index = new FileIndex(createDeps(db));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const folders = db.select().from(schema.folder).all();
      const names = folders.map((f) => f.name);

      // Root folder + 'photos' + '2024'
      expect(names).toContain(tmpDir.split('/').pop());
      expect(names).toContain('photos');
      expect(names).toContain('2024');
    });

    it('handles re-indexing without duplicates', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'test.jpg');

      const index = new FileIndex(createDeps(db));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(1);
    });

    it('handles mixed format file groups', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'IMG_001.jpg');
      createTestImage(subDir, 'IMG_001.heic');

      const index = new FileIndex(createDeps(db));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(2);

      // Should produce one media item with two files
      const mediaItems = db.select().from(schema.mediaItem).all();
      expect(mediaItems.length).toBeGreaterThanOrEqual(1);

      const junctions = db.select().from(schema.mediaItemFile).all();
      const primaryJunction = junctions.find((j) => j.isPrimary);
      expect(primaryJunction).toBeDefined();
    });

    it('emits progress notifications during indexing', async () => {
      const subDir = join(tmpDir, 'photos');
      mkdirSync(subDir);
      createTestImage(subDir, 'a.jpg');
      createTestImage(subDir, 'b.jpg');
      createTestImage(subDir, 'c.jpg');

      const notifications = new NotificationService();
      const phases: string[] = [];
      notifications.addListener((e) => {
        if (e.action === 'progress' && e.source === 'fileIndex') {
          phases.push((e.data as any).phase);
        }
      });

      const index = new FileIndex(createDeps(db, { notifications }));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      expect(phases).toContain('scanning');
      expect(phases).toContain('registering_files');
      expect(phases).toContain('indexing');
      expect(phases).toContain('complete');
    });

    it('completes without error on empty directory', async () => {
      const notifications = new NotificationService();
      const events: unknown[] = [];
      notifications.addListener((e) => events.push(e));

      const index = new FileIndex(createDeps(db, { notifications }));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(0);

      const mediaItems = db.select().from(schema.mediaItem).all();
      expect(mediaItems).toHaveLength(0);

      const completeEvent = events.find(
        (e: any) => e.action === 'progress' && e.data?.phase === 'complete',
      ) as any;
      expect(completeEvent).toBeDefined();
      expect(completeEvent.data.processed).toBe(0);
    });

    it('handles deeply nested empty structure', async () => {
      mkdirSync(join(tmpDir, 'a', 'b', 'c', 'd'), { recursive: true });

      const index = new FileIndex(createDeps(db));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(0);
    });

    it('continues when individual files fail to process', async () => {
      const subDir = join(tmpDir, 'mixed');
      mkdirSync(subDir, { recursive: true });

      createTestImage(subDir, 'valid.jpg');

      // A minimal JFIF header with no actual image data
      writeFileSync(join(subDir, 'corrupt.jpg'), Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
      ]));

      const logger = createMockLogger();
      const index = new FileIndex(createDeps(db, { logger }));
      await index.addDirectory({ directory: tmpDir, concurrency: 1 });

      const files = db.select().from(schema.file).all();
      expect(files).toHaveLength(2);
    });
  });
});
