import { eq, or, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { hammingDistance } from './phash.js';
import * as schema from '../db/schema.js';

const DEFAULT_THRESHOLD = 10;
const DB_SCAN_BATCH_SIZE = 500;

interface CacheEntry {
  mediaItemId: number;
  hash: string;
}

interface MatchResult {
  matchingItemId: number;
  hammingDistance: number;
}

export interface HashMatcherOptions {
  /** Maximum Hamming distance to consider a match. Defaults to 10. */
  threshold?: number;
}

/**
 * Two-phase perceptual hash matcher.
 *
 * Phase 1 checks an in-memory cache of recently indexed items (fast, no I/O).
 * Phase 2 scans the database in batches for items not in the cache.
 *
 * Deduplication rule: only compare when sourceId < targetId so each pair
 * is evaluated exactly once.
 */
export class HashMatcher {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly threshold: number;
  private readonly cache: Map<number, CacheEntry> = new Map();

  constructor(
    db: BetterSQLite3Database<typeof schema>,
    options: HashMatcherOptions = {},
  ) {
    this.db = db;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Compare a media item's hash against all known hashes, create
   * `media_match` records for any matches within the threshold, and
   * add the item to the in-memory cache for future comparisons.
   *
   * Returns the list of new matches that were inserted.
   */
  async matchHash(mediaItemId: number, hash: string): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];

    // Phase 1: in-memory cache
    for (const entry of this.cache.values()) {
      if (!this.shouldCompare(mediaItemId, entry.mediaItemId)) continue;

      const distance = hammingDistance(hash, entry.hash);
      if (distance <= this.threshold) {
        matches.push({ matchingItemId: entry.mediaItemId, hammingDistance: distance });
      }
    }

    // Phase 2: batched DB scan for items not in cache
    const cachedIds = new Set(this.cache.keys());
    let offset = 0;

    for (;;) {
      const rows = this.db
        .select({ id: schema.mediaItem.id, hash: schema.mediaItem.hash })
        .from(schema.mediaItem)
        .limit(DB_SCAN_BATCH_SIZE)
        .offset(offset)
        .all();

      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.id === mediaItemId) continue;
        if (row.hash === null) continue;
        if (cachedIds.has(row.id)) continue;
        if (!this.shouldCompare(mediaItemId, row.id)) continue;

        const distance = hammingDistance(hash, row.hash);
        if (distance <= this.threshold) {
          matches.push({ matchingItemId: row.id, hammingDistance: distance });
        }
      }

      if (rows.length < DB_SCAN_BATCH_SIZE) break;
      offset += DB_SCAN_BATCH_SIZE;
    }

    // Persist matches
    for (const match of matches) {
      await this.insertMatchIfNew(mediaItemId, match);
    }

    // Add to cache for subsequent calls
    this.cache.set(mediaItemId, { mediaItemId, hash });

    return matches;
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
   * Insert a `media_match` record unless one already exists for this pair
   * (in either direction).
   */
  private async insertMatchIfNew(
    mediaItemId: number,
    match: MatchResult,
  ): Promise<void> {
    const [sourceId, targetId] =
      mediaItemId < match.matchingItemId
        ? [mediaItemId, match.matchingItemId]
        : [match.matchingItemId, mediaItemId];

    const existing = this.db
      .select({ id: schema.mediaMatch.id })
      .from(schema.mediaMatch)
      .where(
        or(
          and(
            eq(schema.mediaMatch.mediaItemId, sourceId),
            eq(schema.mediaMatch.matchingItemId, targetId),
          ),
          and(
            eq(schema.mediaMatch.mediaItemId, targetId),
            eq(schema.mediaMatch.matchingItemId, sourceId),
          ),
        ),
      )
      .get();

    if (existing) return;

    this.db
      .insert(schema.mediaMatch)
      .values({
        mediaItemId: sourceId,
        matchingItemId: targetId,
        matchInfo: {
          hamming_distance: match.hammingDistance,
          match_date: new Date().toISOString(),
        },
      })
      .run();
  }
}
