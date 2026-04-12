import { eq, or, and, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { cosineSimilarity } from './face-recognition.js';
import * as schema from '../db/schema.js';

const DEFAULT_SIMILARITY_THRESHOLD = 0.363;
const DB_SCAN_BATCH_SIZE = 500;
const MAX_BFS_DEPTH = 10;

interface CacheEntry {
  featureId: number;
  embedding: Float32Array;
}

interface FaceMatchResult {
  matchingFeatureId: number;
  similarity: number;
}

interface TransitiveMatchResult {
  featureId: number;
  mediaItemId: number;
}

export interface FaceMatcherOptions {
  /** Minimum cosine similarity to consider a match. Defaults to 0.363. */
  threshold?: number;
}

/**
 * Two-phase face embedding matcher.
 *
 * Phase 1 checks an in-memory cache of recently indexed features (fast, no I/O).
 * Phase 2 scans the database in batches for features not in the cache.
 *
 * Deduplication rule: only compare when sourceId < targetId so each pair
 * is evaluated exactly once.
 */
export class FaceMatcher {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly threshold: number;
  private readonly cache: Map<number, CacheEntry> = new Map();

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    options: FaceMatcherOptions = {},
  ) {
    this.db = db;
    this.threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  }

  /**
   * Compare a feature's embedding against all known embeddings, create
   * `feature_match` records for any matches above the threshold, and
   * add the feature to the in-memory cache for future comparisons.
   *
   * Returns the list of new matches that were inserted.
   */
  async matchFace(featureId: number, embedding: Float32Array): Promise<FaceMatchResult[]> {
    const matches: FaceMatchResult[] = [];

    // Phase 1: in-memory cache
    for (const entry of this.cache.values()) {
      if (!this.shouldCompare(featureId, entry.featureId)) continue;

      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity >= this.threshold) {
        matches.push({ matchingFeatureId: entry.featureId, similarity });
      }
    }

    // Phase 2: batched DB scan for features not in cache
    const cachedIds = new Set(this.cache.keys());
    let offset = 0;

    for (;;) {
      const rows = this.db
        .select({ id: schema.feature.id, info: schema.feature.info })
        .from(schema.feature)
        .limit(DB_SCAN_BATCH_SIZE)
        .offset(offset)
        .all();

      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.id === featureId) continue;
        if (cachedIds.has(row.id)) continue;
        if (!this.shouldCompare(featureId, row.id)) continue;

        const rowEmbedding = extractEmbedding(row.info);
        if (!rowEmbedding) continue;

        const similarity = cosineSimilarity(embedding, rowEmbedding);
        if (similarity >= this.threshold) {
          matches.push({ matchingFeatureId: row.id, similarity });
        }
      }

      if (rows.length < DB_SCAN_BATCH_SIZE) break;
      offset += DB_SCAN_BATCH_SIZE;
    }

    // Persist matches
    for (const match of matches) {
      await this.insertMatchIfNew(featureId, match);
    }

    // Add to cache for subsequent calls
    this.cache.set(featureId, { featureId, embedding });

    return matches;
  }

  /**
   * BFS traversal of the face match graph up to MAX_BFS_DEPTH levels.
   * Returns distinct media items whose features transitively match the
   * given feature.
   */
  getMatchingFaces(featureId: number): TransitiveMatchResult[] {
    const visited = new Set<number>();
    let frontier = [featureId];
    visited.add(featureId);

    for (let depth = 0; depth < MAX_BFS_DEPTH && frontier.length > 0; depth++) {
      const nextFrontier: number[] = [];

      for (const fId of frontier) {
        const neighbors = this.getNeighborFeatureIds(fId);
        for (const neighborId of neighbors) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          nextFrontier.push(neighborId);
        }
      }

      frontier = nextFrontier;
    }

    // Remove the source feature itself
    visited.delete(featureId);

    if (visited.size === 0) return [];

    // Batch-resolve feature IDs to media item IDs in a single query
    const matchedIds = [...visited];
    const rows = this.db
      .select({ id: schema.feature.id, itemId: schema.feature.itemId })
      .from(schema.feature)
      .where(inArray(schema.feature.id, matchedIds))
      .all();

    const seenMediaItems = new Set<number>();
    const results: TransitiveMatchResult[] = [];

    for (const row of rows) {
      if (seenMediaItems.has(row.itemId)) continue;
      seenMediaItems.add(row.itemId);
      results.push({ featureId: row.id, mediaItemId: row.itemId });
    }

    return results;
  }

  /** Clear the in-memory cache (e.g. between indexing runs). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Number of entries currently held in the cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Enforce the deduplication invariant: only compare when sourceId < targetId
   * so each pair is evaluated at most once.
   */
  private shouldCompare(sourceId: number, targetId: number): boolean {
    return sourceId < targetId;
  }

  /**
   * Query both directions of the feature_match table for non-ignored matches.
   */
  private getNeighborFeatureIds(featureId: number): number[] {
    const asSource = this.db
      .select({ matchingFeatureId: schema.featureMatch.matchingFeatureId })
      .from(schema.featureMatch)
      .where(
        and(
          eq(schema.featureMatch.featureId, featureId),
          eq(schema.featureMatch.ignoreMatch, false),
        ),
      )
      .all();

    const asTarget = this.db
      .select({ featureId: schema.featureMatch.featureId })
      .from(schema.featureMatch)
      .where(
        and(
          eq(schema.featureMatch.matchingFeatureId, featureId),
          eq(schema.featureMatch.ignoreMatch, false),
        ),
      )
      .all();

    return [
      ...asSource.map((r) => r.matchingFeatureId),
      ...asTarget.map((r) => r.featureId),
    ];
  }

  /**
   * Insert a `feature_match` record unless one already exists for this pair
   * (in either direction).
   */
  private async insertMatchIfNew(
    featureId: number,
    match: FaceMatchResult,
  ): Promise<void> {
    const [sourceId, targetId] =
      featureId < match.matchingFeatureId
        ? [featureId, match.matchingFeatureId]
        : [match.matchingFeatureId, featureId];

    const existing = this.db
      .select({ id: schema.featureMatch.id })
      .from(schema.featureMatch)
      .where(
        or(
          and(
            eq(schema.featureMatch.featureId, sourceId),
            eq(schema.featureMatch.matchingFeatureId, targetId),
          ),
          and(
            eq(schema.featureMatch.featureId, targetId),
            eq(schema.featureMatch.matchingFeatureId, sourceId),
          ),
        ),
      )
      .get();

    if (existing) return;

    this.db
      .insert(schema.featureMatch)
      .values({
        featureId: sourceId,
        matchingFeatureId: targetId,
        matchInfo: {
          similarity: match.similarity,
          match_date: new Date().toISOString(),
        },
      })
      .run();
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Extract a Float32Array embedding from a feature's info JSON column.
 * Returns null if the info doesn't contain a valid embedding.
 */
function extractEmbedding(info: unknown): Float32Array | null {
  if (!info || typeof info !== 'object') return null;
  const record = info as Record<string, unknown>;
  const raw = record.embedding;
  if (!Array.isArray(raw)) return null;
  if (!raw.every((v) => typeof v === 'number' && !Number.isNaN(v))) return null;
  return new Float32Array(raw);
}
