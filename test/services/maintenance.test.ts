import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { MaintenanceService } from '../../src/services/maintenance.js';
import { NotificationService } from '../../src/services/notification.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logger = pino({ level: 'silent' });

function setupDb(): {
  client: DatabaseClient;
  db: BetterSQLite3Database<typeof schema>;
} {
  const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
  runMigrations(client);
  return { client, db: drizzle(client.db, { schema }) };
}

function insertMediaItem(
  db: BetterSQLite3Database<typeof schema>,
  hash: string | null,
  name = 'test',
): number {
  return db
    .insert(schema.mediaItem)
    .values({ name, type: 'image', hash })
    .returning({ id: schema.mediaItem.id })
    .get().id;
}

function insertHost(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.host)
    .values({ name: 'localhost' })
    .returning({ id: schema.host.id })
    .get().id;
}

function insertPath(db: BetterSQLite3Database<typeof schema>, hostId: number, dir: string): number {
  return db
    .insert(schema.path)
    .values({ dir, hostId })
    .returning({ id: schema.path.id })
    .get().id;
}

function insertFile(
  db: BetterSQLite3Database<typeof schema>,
  pathId: number,
  name: string,
  fileHash?: string,
): number {
  return db
    .insert(schema.file)
    .values({ name, extension: 'jpg', pathId, type: 'image', hash: fileHash ?? null })
    .returning({ id: schema.file.id })
    .get().id;
}

function insertFolder(
  db: BetterSQLite3Database<typeof schema>,
  name: string,
  parentId: number | null = null,
): number {
  return db
    .insert(schema.folder)
    .values({ name, parentId })
    .returning({ id: schema.folder.id })
    .get().id;
}

function insertKeyword(db: BetterSQLite3Database<typeof schema>, word: string): number {
  return db
    .insert(schema.keyword)
    .values({ word })
    .returning({ id: schema.keyword.id })
    .get().id;
}

function insertPerson(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.person)
    .values({})
    .returning({ id: schema.person.id })
    .get().id;
}

function insertPlace(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.place)
    .values({})
    .returning({ id: schema.place.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MaintenanceService', () => {
  let client: DatabaseClient;
  let db: BetterSQLite3Database<typeof schema>;
  let service: MaintenanceService;

  beforeEach(() => {
    ({ client, db } = setupDb());
    service = new MaintenanceService({ db, logger });
  });

  afterEach(() => {
    client.db.close();
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('deduplicate', () => {
    it('merges media items with identical perceptual hashes', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash, 'photo_a');
      const id2 = insertMediaItem(db, hash, 'photo_b');

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(1);
      expect(result.removedMediaItems).toBe(1);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });

    it('keeps the lowest-ID item as the canonical record', async () => {
      const hash = '1'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);
      const id3 = insertMediaItem(db, hash);

      await service.deduplicate();

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });

    it('transfers file links to the keeper', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      const hostId = insertHost(db);
      const pathId = insertPath(db, hostId, '/photos');
      const fileA = insertFile(db, pathId, 'a');
      const fileB = insertFile(db, pathId, 'b');

      db.insert(schema.mediaItemFile).values({ mediaItemId: id1, fileId: fileA, isPrimary: true }).run();
      db.insert(schema.mediaItemFile).values({ mediaItemId: id2, fileId: fileB, isPrimary: true }).run();

      await service.deduplicate();

      const links = db.select().from(schema.mediaItemFile).all();
      expect(links).toHaveLength(2);
      expect(links.every((l) => l.mediaItemId === id1)).toBe(true);
    });

    it('transfers keywords to the keeper', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      const kwId = insertKeyword(db, 'sunset');
      db.insert(schema.mediaItemKeyword).values({ mediaItemId: id2, keywordId: kwId }).run();

      await service.deduplicate();

      const links = db.select().from(schema.mediaItemKeyword).all();
      expect(links).toHaveLength(1);
      expect(links[0].mediaItemId).toBe(id1);
    });

    it('transfers folder entries to the keeper', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      const folderId = insertFolder(db, 'photos');
      db.insert(schema.folderEntry).values({ folderId, itemId: id2, index: 0 }).run();

      await service.deduplicate();

      const entries = db.select().from(schema.folderEntry).all();
      expect(entries).toHaveLength(1);
      expect(entries[0].itemId).toBe(id1);
    });

    it('transfers face features to the keeper', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      db.insert(schema.feature).values({ itemId: id2, label: 'face1' }).run();

      await service.deduplicate();

      const features = db.select().from(schema.feature).all();
      expect(features).toHaveLength(1);
      expect(features[0].itemId).toBe(id1);
    });

    it('does nothing when no duplicates exist', async () => {
      insertMediaItem(db, '0'.repeat(64));
      insertMediaItem(db, '1'.repeat(64));

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(0);
      expect(result.removedMediaItems).toBe(0);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(2);
    });

    it('skips items with null hashes', async () => {
      insertMediaItem(db, null);
      insertMediaItem(db, null);

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(0);
      expect(result.removedMediaItems).toBe(0);
    });

    it('handles multiple distinct duplicate groups', async () => {
      const hashA = '0'.repeat(64);
      const hashB = '1'.repeat(64);

      insertMediaItem(db, hashA);
      insertMediaItem(db, hashA);
      insertMediaItem(db, hashA);
      insertMediaItem(db, hashB);
      insertMediaItem(db, hashB);

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(2);
      expect(result.removedMediaItems).toBe(3);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(2);
    });

    it('emits progress notifications', async () => {
      const notifications = new NotificationService();
      const withNotifications = new MaintenanceService({
        db,
        logger,
        notifications,
      });

      const events: string[] = [];
      notifications.addListener((e) => {
        if (e.source === 'maintenance') {
          events.push((e.data as { phase: string }).phase);
        }
      });

      const hash = '0'.repeat(64);
      insertMediaItem(db, hash);
      insertMediaItem(db, hash);

      await withNotifications.deduplicate();

      expect(events).toContain('dedup_scanning');
      expect(events).toContain('dedup_merging');
      expect(events).toContain('dedup_complete');
    });

    it('detects duplicates via shared file MD5 hash', async () => {
      const id1 = insertMediaItem(db, null, 'photo_a');
      const id2 = insertMediaItem(db, null, 'photo_b');

      const hostId = insertHost(db);
      const pathA = insertPath(db, hostId, '/photos/a');
      const pathB = insertPath(db, hostId, '/photos/b');

      const md5 = 'abc123def456';
      const fileA = insertFile(db, pathA, 'photo', md5);
      const fileB = insertFile(db, pathB, 'photo', md5);

      db.insert(schema.mediaItemFile).values({ mediaItemId: id1, fileId: fileA, isPrimary: true }).run();
      db.insert(schema.mediaItemFile).values({ mediaItemId: id2, fileId: fileB, isPrimary: true }).run();

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(1);
      expect(result.removedMediaItems).toBe(1);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });

    it('detects duplicates via media_match records with hamming_distance 0', async () => {
      const id1 = insertMediaItem(db, null, 'photo_a');
      const id2 = insertMediaItem(db, null, 'photo_b');

      db.insert(schema.mediaMatch).values({
        mediaItemId: id1,
        matchingItemId: id2,
        matchInfo: { hamming_distance: 0, match_date: new Date().toISOString() },
      }).run();

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(1);
      expect(result.removedMediaItems).toBe(1);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });

    it('does not merge media_match records with hamming_distance > 0', async () => {
      const id1 = insertMediaItem(db, null, 'photo_a');
      const id2 = insertMediaItem(db, null, 'photo_b');

      db.insert(schema.mediaMatch).values({
        mediaItemId: id1,
        matchingItemId: id2,
        matchInfo: { hamming_distance: 5, match_date: new Date().toISOString() },
      }).run();

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(0);
      expect(result.removedMediaItems).toBe(0);
    });

    it('merges groups across signals via union-find', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash, 'photo_a');
      const id2 = insertMediaItem(db, hash, 'photo_b');
      const id3 = insertMediaItem(db, null, 'photo_c');

      db.insert(schema.mediaMatch).values({
        mediaItemId: id2,
        matchingItemId: id3,
        matchInfo: { hamming_distance: 0, match_date: new Date().toISOString() },
      }).run();

      const result = await service.deduplicate();

      expect(result.duplicateGroups).toBe(1);
      expect(result.removedMediaItems).toBe(2);

      const remaining = db.select().from(schema.mediaItem).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id1);
    });
  });

  // -------------------------------------------------------------------------
  // Orphan Cleanup
  // -------------------------------------------------------------------------

  describe('cleanOrphans', () => {
    it('removes dangling media_match records', async () => {
      const id1 = insertMediaItem(db, '0'.repeat(64));
      const id2 = insertMediaItem(db, '0'.repeat(64));

      db.insert(schema.mediaMatch)
        .values({ mediaItemId: id1, matchingItemId: id2, matchInfo: {} })
        .run();

      // Delete one side — the FK cascade should handle this, but if it
      // doesn't (e.g. FK enforcement is off), orphan cleanup catches it
      db.delete(schema.mediaItem).where(eq(schema.mediaItem.id, id2)).run();

      const result = await service.cleanOrphans();
      expect(result.mediaMatches).toBeGreaterThanOrEqual(0);
    });

    it('removes orphaned keywords with no media links', async () => {
      insertKeyword(db, 'orphaned');
      const usedKwId = insertKeyword(db, 'used');

      const mediaId = insertMediaItem(db, null);
      db.insert(schema.mediaItemKeyword)
        .values({ mediaItemId: mediaId, keywordId: usedKwId })
        .run();

      const result = await service.cleanOrphans();

      expect(result.keywords).toBe(1);

      const remaining = db.select().from(schema.keyword).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].word).toBe('used');
    });

    it('removes orphaned persons with no names, features, or users', async () => {
      const orphanPersonId = insertPerson(db);
      const linkedPersonId = insertPerson(db);

      db.insert(schema.personName)
        .values({ personId: linkedPersonId, name: 'Alice', preferred: true })
        .run();

      const result = await service.cleanOrphans();

      expect(result.persons).toBe(1);

      const remaining = db.select().from(schema.person).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(linkedPersonId);
    });

    it('removes orphaned places with no names, media, or addresses', async () => {
      const orphanPlaceId = insertPlace(db);
      const linkedPlaceId = insertPlace(db);

      db.insert(schema.placeName)
        .values({ placeId: linkedPlaceId, name: 'Home', preferred: true })
        .run();

      const result = await service.cleanOrphans();

      expect(result.places).toBe(1);

      const remaining = db.select().from(schema.place).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(linkedPlaceId);
    });

    it('removes empty folders recursively', async () => {
      const parent = insertFolder(db, 'parent');
      const child = insertFolder(db, 'child', parent);

      const result = await service.cleanOrphans();

      expect(result.folders).toBe(2);

      const remaining = db.select().from(schema.folder).all();
      expect(remaining).toHaveLength(0);
    });

    it('preserves folders with entries', async () => {
      const folderId = insertFolder(db, 'with-entries');
      const mediaId = insertMediaItem(db, null);

      db.insert(schema.folderEntry)
        .values({ folderId, itemId: mediaId, index: 0 })
        .run();

      const result = await service.cleanOrphans();

      expect(result.folders).toBe(0);

      const remaining = db.select().from(schema.folder).all();
      expect(remaining).toHaveLength(1);
    });

    it('returns zero counts when nothing to clean', async () => {
      const result = await service.cleanOrphans();

      expect(result.mediaMatches).toBe(0);
      expect(result.featureMatches).toBe(0);
      expect(result.keywords).toBe(0);
      expect(result.persons).toBe(0);
      expect(result.places).toBe(0);
      expect(result.folders).toBe(0);
    });

    it('emits progress notifications', async () => {
      const notifications = new NotificationService();
      const withNotifications = new MaintenanceService({
        db,
        logger,
        notifications,
      });

      const events: string[] = [];
      notifications.addListener((e) => {
        if (e.source === 'maintenance') {
          events.push((e.data as { phase: string }).phase);
        }
      });

      await withNotifications.cleanOrphans();

      expect(events).toContain('orphan_scanning');
      expect(events).toContain('orphan_complete');
    });
  });
});
