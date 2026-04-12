import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { FaceMatcher } from '../../src/services/face-matcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmbedding(seed: number, length = 128): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = Math.sin(seed * (i + 1));
  }
  const norm = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < length; i++) arr[i] /= norm;
  return arr;
}

function setupDb(): {
  client: DatabaseClient;
  db: BetterSQLite3Database<typeof schema>;
} {
  const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
  runMigrations(client);
  return { client, db: drizzle(client.db, { schema }) };
}

function insertMediaItem(db: BetterSQLite3Database<typeof schema>): number {
  return db
    .insert(schema.mediaItem)
    .values({ name: 'test', type: 'image' })
    .returning({ id: schema.mediaItem.id })
    .get().id;
}

function insertFeature(
  db: BetterSQLite3Database<typeof schema>,
  mediaItemId: number,
  embedding: Float32Array,
): number {
  return db
    .insert(schema.feature)
    .values({
      itemId: mediaItemId,
      info: { embedding: Array.from(embedding) },
    })
    .returning({ id: schema.feature.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FaceMatcher', () => {
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

  describe('matchFace', () => {
    it('finds an exact match (same embedding)', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const featureA = insertFeature(db, itemA, embedding);
      const featureB = insertFeature(db, itemB, embedding);

      const matcher = new FaceMatcher(db);
      const matches = await matcher.matchFace(featureA, embedding);

      expect(matches).toHaveLength(1);
      expect(matches[0].matchingFeatureId).toBe(featureB);
      expect(matches[0].similarity).toBeCloseTo(1.0, 5);
    });

    it('finds matches above the threshold', async () => {
      const embA = makeEmbedding(1);
      const embB = makeEmbedding(1.01); // very similar seed → high cosine similarity

      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const featureA = insertFeature(db, itemA, embA);
      insertFeature(db, itemB, embB);

      const matcher = new FaceMatcher(db, { threshold: 0.1 });
      const matches = await matcher.matchFace(featureA, embA);

      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('ignores features below the threshold', async () => {
      const embA = makeEmbedding(1);
      const embB = makeEmbedding(100); // very different seed → low similarity

      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const featureA = insertFeature(db, itemA, embA);
      insertFeature(db, itemB, embB);

      const matcher = new FaceMatcher(db, { threshold: 0.99 });
      const matches = await matcher.matchFace(featureA, embA);

      expect(matches).toHaveLength(0);
    });

    it('skips features with no embedding in info', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const featureA = insertFeature(db, itemA, embedding);

      db.insert(schema.feature)
        .values({ itemId: itemB, info: { some_other_data: true } })
        .run();

      const matcher = new FaceMatcher(db);
      const matches = await matcher.matchFace(featureA, embedding);

      expect(matches).toHaveLength(0);
    });

    it('skips features with non-numeric embedding values', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const featureA = insertFeature(db, itemA, embedding);

      db.insert(schema.feature)
        .values({ itemId: itemB, info: { embedding: ['not', 'numbers'] } })
        .run();

      const matcher = new FaceMatcher(db);
      const matches = await matcher.matchFace(featureA, embedding);

      expect(matches).toHaveLength(0);
    });

    it('does not compare a feature against itself', async () => {
      const embedding = makeEmbedding(1);
      const item = insertMediaItem(db);
      const featureId = insertFeature(db, item, embedding);

      const matcher = new FaceMatcher(db);
      const matches = await matcher.matchFace(featureId, embedding);

      expect(matches).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('only compares when sourceId < targetId', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const id1 = insertFeature(db, itemA, embedding);
      const id2 = insertFeature(db, itemB, embedding);
      expect(id1).toBeLessThan(id2);

      const matcher = new FaceMatcher(db);

      const forward = await matcher.matchFace(id1, embedding);
      expect(forward).toHaveLength(1);

      const matcher2 = new FaceMatcher(db);
      const reverse = await matcher2.matchFace(id2, embedding);
      expect(reverse).toHaveLength(0);
    });

    it('does not insert duplicate match records', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      insertFeature(db, itemA, embedding);
      insertFeature(db, itemB, embedding);

      const matcher = new FaceMatcher(db);
      const id1 = db.select({ id: schema.feature.id }).from(schema.feature).all()[0].id;

      await matcher.matchFace(id1, embedding);
      matcher.clearCache();
      await matcher.matchFace(id1, embedding);

      const allMatches = db.select().from(schema.featureMatch).all();
      expect(allMatches).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Two-phase matching (cache + DB)
  // -------------------------------------------------------------------------

  describe('two-phase matching', () => {
    it('uses the in-memory cache for recently added features', async () => {
      const embedding = makeEmbedding(1);
      const items = [insertMediaItem(db), insertMediaItem(db), insertMediaItem(db)];
      const features = items.map((itemId) => insertFeature(db, itemId, embedding));

      const matcher = new FaceMatcher(db);

      await matcher.matchFace(features[0], embedding);
      expect(matcher.cacheSize).toBe(1);

      const matches = await matcher.matchFace(features[1], embedding);
      expect(matcher.cacheSize).toBe(2);

      // features[1] > features[0] → skip (dedup). features[1] < features[2] → match.
      expect(matches).toHaveLength(1);
      expect(matches[0].matchingFeatureId).toBe(features[2]);
    });

    it('clearCache resets the cache', async () => {
      const embedding = makeEmbedding(1);
      const item = insertMediaItem(db);
      const featureId = insertFeature(db, item, embedding);

      const matcher = new FaceMatcher(db);
      await matcher.matchFace(featureId, embedding);
      expect(matcher.cacheSize).toBe(1);

      matcher.clearCache();
      expect(matcher.cacheSize).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Match record persistence
  // -------------------------------------------------------------------------

  describe('match record persistence', () => {
    it('creates feature_match records with match info', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const id1 = insertFeature(db, itemA, embedding);
      const id2 = insertFeature(db, itemB, embedding);

      const matcher = new FaceMatcher(db);
      await matcher.matchFace(id1, embedding);

      const records = db.select().from(schema.featureMatch).all();
      expect(records).toHaveLength(1);

      const record = records[0];
      expect(record.featureId).toBe(id1);
      expect(record.matchingFeatureId).toBe(id2);
      expect(record.ignoreMatch).toBe(false);

      const info = record.matchInfo as { similarity: number; match_date: string };
      expect(info.similarity).toBeCloseTo(1.0, 5);
      expect(info.match_date).toBeTruthy();
    });

    it('normalizes match records so smaller ID is always featureId', async () => {
      const embA = makeEmbedding(1);
      const embB = makeEmbedding(1.001);

      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const id1 = insertFeature(db, itemA, embA);
      const id2 = insertFeature(db, itemB, embB);

      const matcher = new FaceMatcher(db, { threshold: 0.1 });
      await matcher.matchFace(id1, embA);

      const records = db.select().from(schema.featureMatch).all();
      if (records.length > 0) {
        expect(records[0].featureId).toBe(Math.min(id1, id2));
        expect(records[0].matchingFeatureId).toBe(Math.max(id1, id2));
      }
    });
  });

  // -------------------------------------------------------------------------
  // Transitive matching (BFS)
  // -------------------------------------------------------------------------

  describe('getMatchingFaces', () => {
    it('returns direct matches', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const fA = insertFeature(db, itemA, embedding);
      const fB = insertFeature(db, itemB, embedding);

      const matcher = new FaceMatcher(db);
      await matcher.matchFace(fA, embedding);

      const results = matcher.getMatchingFaces(fA);
      expect(results).toHaveLength(1);
      expect(results[0].featureId).toBe(fB);
      expect(results[0].mediaItemId).toBe(itemB);
    });

    it('follows transitive matches across multiple levels', async () => {
      // Chain: fA ↔ fB ↔ fC (fA and fC are not directly matched)
      const embA = makeEmbedding(1);
      const embB = makeEmbedding(1);
      const embC = makeEmbedding(1);

      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const itemC = insertMediaItem(db);
      const fA = insertFeature(db, itemA, embA);
      const fB = insertFeature(db, itemB, embB);
      const fC = insertFeature(db, itemC, embC);

      // Manually insert match records to form a chain
      db.insert(schema.featureMatch)
        .values({
          featureId: fA,
          matchingFeatureId: fB,
          matchInfo: { similarity: 0.95, match_date: new Date().toISOString() },
        })
        .run();
      db.insert(schema.featureMatch)
        .values({
          featureId: fB,
          matchingFeatureId: fC,
          matchInfo: { similarity: 0.90, match_date: new Date().toISOString() },
        })
        .run();

      const matcher = new FaceMatcher(db);
      const results = matcher.getMatchingFaces(fA);

      const mediaItemIds = results.map((r) => r.mediaItemId).sort();
      expect(mediaItemIds).toEqual([itemB, itemC].sort());
    });

    it('deduplicates media items when multiple features belong to the same item', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const fA = insertFeature(db, itemA, embedding);
      const fB1 = insertFeature(db, itemB, embedding);
      const fB2 = insertFeature(db, itemB, embedding);

      db.insert(schema.featureMatch)
        .values({
          featureId: fA,
          matchingFeatureId: fB1,
          matchInfo: { similarity: 0.95, match_date: new Date().toISOString() },
        })
        .run();
      db.insert(schema.featureMatch)
        .values({
          featureId: fA,
          matchingFeatureId: fB2,
          matchInfo: { similarity: 0.90, match_date: new Date().toISOString() },
        })
        .run();

      const matcher = new FaceMatcher(db);
      const results = matcher.getMatchingFaces(fA);

      expect(results).toHaveLength(1);
      expect(results[0].mediaItemId).toBe(itemB);
    });

    it('respects ignore_match flag', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const fA = insertFeature(db, itemA, embedding);
      const fB = insertFeature(db, itemB, embedding);

      db.insert(schema.featureMatch)
        .values({
          featureId: fA,
          matchingFeatureId: fB,
          matchInfo: { similarity: 0.95, match_date: new Date().toISOString() },
          ignoreMatch: true,
        })
        .run();

      const matcher = new FaceMatcher(db);
      const results = matcher.getMatchingFaces(fA);

      expect(results).toHaveLength(0);
    });

    it('returns empty for a feature with no matches', () => {
      const embedding = makeEmbedding(1);
      const item = insertMediaItem(db);
      const featureId = insertFeature(db, item, embedding);

      const matcher = new FaceMatcher(db);
      const results = matcher.getMatchingFaces(featureId);

      expect(results).toHaveLength(0);
    });

    it('handles cycles without infinite loops', async () => {
      const embedding = makeEmbedding(1);
      const itemA = insertMediaItem(db);
      const itemB = insertMediaItem(db);
      const itemC = insertMediaItem(db);
      const fA = insertFeature(db, itemA, embedding);
      const fB = insertFeature(db, itemB, embedding);
      const fC = insertFeature(db, itemC, embedding);

      // Create a cycle: A ↔ B ↔ C ↔ A
      db.insert(schema.featureMatch)
        .values({ featureId: fA, matchingFeatureId: fB, matchInfo: { similarity: 0.9, match_date: new Date().toISOString() } })
        .run();
      db.insert(schema.featureMatch)
        .values({ featureId: fB, matchingFeatureId: fC, matchInfo: { similarity: 0.9, match_date: new Date().toISOString() } })
        .run();
      db.insert(schema.featureMatch)
        .values({ featureId: fC, matchingFeatureId: fA, matchInfo: { similarity: 0.9, match_date: new Date().toISOString() } })
        .run();

      const matcher = new FaceMatcher(db);
      const results = matcher.getMatchingFaces(fA);

      const mediaItemIds = results.map((r) => r.mediaItemId).sort();
      expect(mediaItemIds).toEqual([itemB, itemC].sort());
    });
  });

  // -------------------------------------------------------------------------
  // Batch scanning
  // -------------------------------------------------------------------------

  describe('batch scanning', () => {
    it('handles more features than a single batch', async () => {
      const embedding = makeEmbedding(1);

      const ids: number[] = [];
      for (let i = 0; i < 10; i++) {
        const itemId = insertMediaItem(db);
        ids.push(insertFeature(db, itemId, embedding));
      }

      const matcher = new FaceMatcher(db);
      const sourceId = ids[0];
      const matches = await matcher.matchFace(sourceId, embedding);

      expect(matches).toHaveLength(9);
    });
  });
});
