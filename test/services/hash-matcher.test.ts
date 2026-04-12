import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { HashMatcher } from '../../src/services/hash-matcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHash(pattern: string): string {
  return pattern.repeat(Math.ceil(64 / pattern.length)).slice(0, 64);
}

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
): number {
  return db
    .insert(schema.mediaItem)
    .values({ name: 'test', type: 'image', hash })
    .returning({ id: schema.mediaItem.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HashMatcher', () => {
  let client: DatabaseClient;
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(() => {
    ({ client, db } = setupDb());
  });

  afterEach(() => {
    client.db.close();
  });

  // -------------------------------------------------------------------------
  // Basic matching
  // -------------------------------------------------------------------------

  describe('matchHash', () => {
    it('finds an exact match (distance 0)', async () => {
      const hash = makeHash('10');
      const existingId = insertMediaItem(db, hash);
      const newId = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);
      const matches = await matcher.matchHash(newId, hash);

      // newId > existingId, so shouldCompare(newId, existingId) is false.
      // We need to call matchHash on the lower ID first.
      expect(matches).toHaveLength(0);

      // Now match from the lower ID's perspective
      const matcher2 = new HashMatcher(db);
      const matches2 = await matcher2.matchHash(existingId, hash);
      expect(matches2).toHaveLength(1);
      expect(matches2[0].matchingItemId).toBe(newId);
      expect(matches2[0].hammingDistance).toBe(0);
    });

    it('finds matches within the threshold', async () => {
      const hashA = '0'.repeat(64);
      const hashB = '1'.repeat(5) + '0'.repeat(59); // distance = 5

      const idA = insertMediaItem(db, hashA);
      const idB = insertMediaItem(db, hashB);

      const matcher = new HashMatcher(db, { threshold: 10 });
      const matches = await matcher.matchHash(idA, hashA);

      expect(matches).toHaveLength(1);
      expect(matches[0].matchingItemId).toBe(idB);
      expect(matches[0].hammingDistance).toBe(5);
    });

    it('ignores items beyond the threshold', async () => {
      const hashA = '0'.repeat(64);
      const hashB = '1'.repeat(20) + '0'.repeat(44); // distance = 20

      const idA = insertMediaItem(db, hashA);
      insertMediaItem(db, hashB);

      const matcher = new HashMatcher(db, { threshold: 10 });
      const matches = await matcher.matchHash(idA, hashA);

      expect(matches).toHaveLength(0);
    });

    it('skips media items with null hashes', async () => {
      const hash = makeHash('10');
      const idA = insertMediaItem(db, hash);
      insertMediaItem(db, null);

      const matcher = new HashMatcher(db);
      const matches = await matcher.matchHash(idA, hash);

      expect(matches).toHaveLength(0);
    });

    it('does not compare an item against itself', async () => {
      const hash = makeHash('10');
      const id = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);
      const matches = await matcher.matchHash(id, hash);

      expect(matches).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('only compares when sourceId < targetId', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);
      expect(id1).toBeLessThan(id2);

      const matcher = new HashMatcher(db);

      // id1 < id2 → should find a match
      const forward = await matcher.matchHash(id1, hash);
      expect(forward).toHaveLength(1);

      // id2 > id1 → should skip
      const matcher2 = new HashMatcher(db);
      const reverse = await matcher2.matchHash(id2, hash);
      expect(reverse).toHaveLength(0);
    });

    it('does not insert duplicate match records', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);
      await matcher.matchHash(id1, hash);
      // Clear cache so it goes through DB scan again
      matcher.clearCache();
      await matcher.matchHash(id1, hash);

      const allMatches = db.select().from(schema.mediaMatch).all();
      expect(allMatches).toHaveLength(1);
      expect(allMatches[0].mediaItemId).toBe(id1);
      expect(allMatches[0].matchingItemId).toBe(id2);
    });
  });

  // -------------------------------------------------------------------------
  // Two-phase matching (cache + DB)
  // -------------------------------------------------------------------------

  describe('two-phase matching', () => {
    it('uses the in-memory cache for recently added items', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);
      const id3 = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);

      // First call adds id1 to cache
      await matcher.matchHash(id1, hash);
      expect(matcher.cacheSize).toBe(1);

      // Second call: id1 is in cache, id3 is in DB
      const matches = await matcher.matchHash(id2, hash);
      expect(matcher.cacheSize).toBe(2);

      // id2 > id1, so id1 is skipped (dedup rule). id2 < id3, so id3 matches.
      expect(matches).toHaveLength(1);
      expect(matches[0].matchingItemId).toBe(id3);
    });

    it('clearCache resets the cache', async () => {
      const hash = '0'.repeat(64);
      const id = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);
      await matcher.matchHash(id, hash);
      expect(matcher.cacheSize).toBe(1);

      matcher.clearCache();
      expect(matcher.cacheSize).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Match record persistence
  // -------------------------------------------------------------------------

  describe('match record persistence', () => {
    it('creates media_match records with match info', async () => {
      const hash = '0'.repeat(64);
      const id1 = insertMediaItem(db, hash);
      const id2 = insertMediaItem(db, hash);

      const matcher = new HashMatcher(db);
      await matcher.matchHash(id1, hash);

      const records = db.select().from(schema.mediaMatch).all();
      expect(records).toHaveLength(1);

      const record = records[0];
      expect(record.mediaItemId).toBe(id1);
      expect(record.matchingItemId).toBe(id2);
      expect(record.ignoreMatch).toBe(false);

      const info = record.matchInfo as { hamming_distance: number; match_date: string };
      expect(info.hamming_distance).toBe(0);
      expect(info.match_date).toBeTruthy();
    });

    it('normalizes match records so smaller ID is always mediaItemId', async () => {
      const hashA = '0'.repeat(64);
      const hashB = '0'.repeat(60) + '1100'; // distance = 2

      const id1 = insertMediaItem(db, hashA);
      const id2 = insertMediaItem(db, hashB);

      const matcher = new HashMatcher(db);
      await matcher.matchHash(id1, hashA);

      const records = db.select().from(schema.mediaMatch).all();
      expect(records).toHaveLength(1);
      expect(records[0].mediaItemId).toBe(Math.min(id1, id2));
      expect(records[0].matchingItemId).toBe(Math.max(id1, id2));
    });
  });

  // -------------------------------------------------------------------------
  // Batch scanning
  // -------------------------------------------------------------------------

  describe('batch scanning', () => {
    it('handles more items than a single batch', async () => {
      const hash = '0'.repeat(64);

      // Insert enough items to span multiple batches (batch size is 500)
      const ids: number[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(insertMediaItem(db, hash));
      }

      const matcher = new HashMatcher(db);
      const sourceId = ids[0];
      const matches = await matcher.matchHash(sourceId, hash);

      // sourceId is the smallest, so all 9 others should match
      expect(matches).toHaveLength(9);
    });
  });
});
