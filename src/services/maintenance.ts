import { eq, and, sql, inArray, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Logger } from 'pino';
import * as schema from '../db/schema.js';
import { type NotificationService } from './notification.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenanceDeps {
  db: BetterSQLite3Database<typeof schema>;
  logger: Logger;
  notifications?: NotificationService;
}

export interface DedupResult {
  duplicateGroups: number;
  mergedMediaItems: number;
  removedMediaItems: number;
}

export interface OrphanCleanupResult {
  mediaMatches: number;
  featureMatches: number;
  keywords: number;
  persons: number;
  places: number;
  folders: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Database maintenance operations: deduplication of media items that were
 * indexed more than once, and cleanup of orphaned junction/reference records
 * that cascade deletes may have missed.
 */
export class MaintenanceService {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly logger: Logger;
  private readonly notifications?: NotificationService;

  constructor(deps: MaintenanceDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.notifications = deps.notifications;
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  /**
   * Find media items that are exact duplicates (identical perceptual hash,
   * Hamming distance = 0) and merge them into a single canonical item
   * (the one with the lowest ID). Transfers file links, folder entries,
   * keywords, ratings, features, and place links to the keeper, then
   * deletes the duplicates. Cascade deletes handle match records, access
   * controls, and log entries automatically.
   */
  async deduplicate(): Promise<DedupResult> {
    this.notifications?.notify('progress', 'maintenance', { phase: 'dedup_scanning' });

    const groups = this.findDuplicateGroups();
    const total = groups.length;

    this.logger.info({ groups: total }, 'Found duplicate groups to merge');

    let mergedMediaItems = 0;
    let removedMediaItems = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const [keeper, ...duplicates] = group;

      for (const dupId of duplicates) {
        this.mergeMediaItem(keeper, dupId);
        removedMediaItems++;
      }

      mergedMediaItems++;

      this.notifications?.notify('progress', 'maintenance', {
        phase: 'dedup_merging',
        processed: i + 1,
        total,
      });
    }

    this.notifications?.notify('progress', 'maintenance', {
      phase: 'dedup_complete',
      duplicateGroups: total,
      removedMediaItems,
    });

    this.logger.info(
      { duplicateGroups: total, mergedMediaItems, removedMediaItems },
      'Deduplication complete',
    );

    return { duplicateGroups: total, mergedMediaItems, removedMediaItems };
  }

  /**
   * Identify groups of duplicate media items using three signals:
   * 1. Identical perceptual hash (media_item.hash)
   * 2. Shared file content (same file.hash MD5 linked to different media items)
   * 3. Existing media_match records with Hamming distance = 0
   *
   * Uses union-find to merge overlapping pairs into connected groups.
   * Returns arrays of media item IDs (sorted ascending, keeper first).
   */
  private findDuplicateGroups(): number[][] {
    const parent = new Map<number, number>();

    function find(x: number): number {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let curr = x;
      while (curr !== root) {
        const next = parent.get(curr)!;
        parent.set(curr, root);
        curr = next;
      }
      return root;
    }

    function union(a: number, b: number): void {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        const [lo, hi] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
        parent.set(hi, lo);
      }
    }

    // Signal 1: identical perceptual hash
    const hashRows = this.db
      .select({
        hash: schema.mediaItem.hash,
      })
      .from(schema.mediaItem)
      .where(sql`${schema.mediaItem.hash} is not null AND ${schema.mediaItem.hash} != ''`)
      .groupBy(schema.mediaItem.hash)
      .having(sql`count(*) > 1`)
      .all();

    for (const row of hashRows) {
      const items = this.db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.hash, row.hash!))
        .orderBy(schema.mediaItem.id)
        .all();

      for (let i = 1; i < items.length; i++) {
        union(items[0].id, items[i].id);
      }
    }

    // Signal 2: shared file MD5 hash across different media items
    const fileHashRows = this.db
      .select({
        fileHash: schema.file.hash,
      })
      .from(schema.file)
      .where(sql`${schema.file.hash} is not null AND ${schema.file.hash} != ''`)
      .groupBy(schema.file.hash)
      .having(sql`count(*) > 1`)
      .all();

    for (const row of fileHashRows) {
      const mediaIds = this.db
        .select({ mediaItemId: schema.mediaItemFile.mediaItemId })
        .from(schema.file)
        .innerJoin(schema.mediaItemFile, eq(schema.mediaItemFile.fileId, schema.file.id))
        .where(eq(schema.file.hash, row.fileHash!))
        .groupBy(schema.mediaItemFile.mediaItemId)
        .orderBy(schema.mediaItemFile.mediaItemId)
        .all();

      const ids = [...new Set(mediaIds.map((r) => r.mediaItemId))];
      for (let i = 1; i < ids.length; i++) {
        union(ids[0], ids[i]);
      }
    }

    // Signal 3: existing media_match records with Hamming distance = 0
    const exactMatches = this.db
      .select({
        mediaItemId: schema.mediaMatch.mediaItemId,
        matchingItemId: schema.mediaMatch.matchingItemId,
        matchInfo: schema.mediaMatch.matchInfo,
      })
      .from(schema.mediaMatch)
      .where(eq(schema.mediaMatch.ignoreMatch, false))
      .all();

    for (const match of exactMatches) {
      const info = match.matchInfo as { hamming_distance?: number } | null;
      if (info?.hamming_distance === 0) {
        union(match.mediaItemId, match.matchingItemId);
      }
    }

    // Collect groups from union-find
    const groupMap = new Map<number, number[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      let group = groupMap.get(root);
      if (!group) {
        group = [];
        groupMap.set(root, group);
      }
      group.push(id);
    }

    const groups: number[][] = [];
    for (const members of groupMap.values()) {
      if (members.length > 1) {
        members.sort((a, b) => a - b);
        groups.push(members);
      }
    }

    return groups;
  }

  /**
   * Merge a duplicate media item into the keeper: transfer all related
   * records, then delete the duplicate. Uses onConflictDoNothing for
   * junction tables that have unique constraints.
   */
  private mergeMediaItem(keeperId: number, duplicateId: number): void {
    this.logger.debug({ keeperId, duplicateId }, 'Merging duplicate media item');

    // Transfer file links
    const dupFiles = this.db
      .select()
      .from(schema.mediaItemFile)
      .where(eq(schema.mediaItemFile.mediaItemId, duplicateId))
      .all();

    for (const f of dupFiles) {
      this.db
        .insert(schema.mediaItemFile)
        .values({ mediaItemId: keeperId, fileId: f.fileId, isPrimary: false })
        .onConflictDoNothing()
        .run();
    }

    // Transfer folder entries
    const dupFolderEntries = this.db
      .select()
      .from(schema.folderEntry)
      .where(eq(schema.folderEntry.itemId, duplicateId))
      .all();

    for (const fe of dupFolderEntries) {
      this.db
        .insert(schema.folderEntry)
        .values({ folderId: fe.folderId, itemId: keeperId, index: fe.index })
        .onConflictDoNothing()
        .run();
    }

    // Transfer keywords
    const dupKeywords = this.db
      .select()
      .from(schema.mediaItemKeyword)
      .where(eq(schema.mediaItemKeyword.mediaItemId, duplicateId))
      .all();

    for (const kw of dupKeywords) {
      this.db
        .insert(schema.mediaItemKeyword)
        .values({ mediaItemId: keeperId, keywordId: kw.keywordId })
        .onConflictDoNothing()
        .run();
    }

    // Transfer ratings (keep unique per user — skip if user already rated keeper)
    const dupRatings = this.db
      .select()
      .from(schema.userRating)
      .where(eq(schema.userRating.itemId, duplicateId))
      .all();

    for (const r of dupRatings) {
      const existing = this.db
        .select({ id: schema.userRating.id })
        .from(schema.userRating)
        .where(and(eq(schema.userRating.userId, r.userId), eq(schema.userRating.itemId, keeperId)))
        .get();

      if (!existing) {
        this.db
          .update(schema.userRating)
          .set({ itemId: keeperId })
          .where(eq(schema.userRating.id, r.id))
          .run();
      }
    }

    // Transfer features (faces) — re-point to keeper
    this.db
      .update(schema.feature)
      .set({ itemId: keeperId })
      .where(eq(schema.feature.itemId, duplicateId))
      .run();

    // Transfer place links
    const dupPlaceMedia = this.db
      .select()
      .from(schema.placeMedia)
      .where(eq(schema.placeMedia.mediaId, duplicateId))
      .all();

    for (const pm of dupPlaceMedia) {
      const existing = this.db
        .select({ id: schema.placeMedia.id })
        .from(schema.placeMedia)
        .where(
          and(eq(schema.placeMedia.mediaId, keeperId), eq(schema.placeMedia.placeId, pm.placeId)),
        )
        .get();

      if (!existing) {
        this.db
          .update(schema.placeMedia)
          .set({ mediaId: keeperId })
          .where(eq(schema.placeMedia.id, pm.id))
          .run();
      }
    }

    // Transfer media access
    const dupAccess = this.db
      .select()
      .from(schema.mediaAccess)
      .where(eq(schema.mediaAccess.itemId, duplicateId))
      .all();

    for (const ma of dupAccess) {
      const existing = this.db
        .select({ id: schema.mediaAccess.id })
        .from(schema.mediaAccess)
        .where(
          and(eq(schema.mediaAccess.itemId, keeperId), eq(schema.mediaAccess.groupId, ma.groupId)),
        )
        .get();

      if (!existing) {
        this.db
          .update(schema.mediaAccess)
          .set({ itemId: keeperId })
          .where(eq(schema.mediaAccess.id, ma.id))
          .run();
      }
    }

    // Delete the duplicate — cascade handles media_item_file, folder_entry,
    // media_item_keyword, media_match, media_access, media_log
    this.db
      .delete(schema.mediaItem)
      .where(eq(schema.mediaItem.id, duplicateId))
      .run();

    this.notifications?.notify('delete', 'mediaItem', { id: duplicateId });
  }

  // -------------------------------------------------------------------------
  // Orphan Cleanup (database-level)
  // -------------------------------------------------------------------------

  /**
   * Remove orphaned database records that lack valid parent references.
   * This complements FileIndex.deleteOrphans() (which focuses on disk↔DB
   * consistency) by cleaning up relational orphans:
   *
   * - `keyword` records with no `media_item_keyword` links
   * - `person` records with no `person_name`, `person_feature`, or `user` links
   * - `place` records with no `place_name` or `place_media` links
   * - `folder` records with no entries and no children
   * - Dangling `media_match` where either side no longer exists
   * - Dangling `feature_match` where either side no longer exists
   */
  async cleanOrphans(): Promise<OrphanCleanupResult> {
    this.notifications?.notify('progress', 'maintenance', { phase: 'orphan_scanning' });

    const mediaMatches = this.cleanOrphanedMediaMatches();
    const featureMatches = this.cleanOrphanedFeatureMatches();
    const keywords = this.cleanOrphanedKeywords();
    const persons = this.cleanOrphanedPersons();
    const places = this.cleanOrphanedPlaces();
    const folders = this.cleanEmptyFolders();

    const result: OrphanCleanupResult = {
      mediaMatches,
      featureMatches,
      keywords,
      persons,
      places,
      folders,
    };

    this.notifications?.notify('progress', 'maintenance', {
      phase: 'orphan_complete',
      ...result,
    });

    this.logger.info(result, 'Orphan cleanup complete');

    return result;
  }

  private cleanOrphanedMediaMatches(): number {
    const allMediaItemIds = this.db
      .select({ id: schema.mediaItem.id })
      .from(schema.mediaItem)
      .all()
      .map((r) => r.id);

    if (allMediaItemIds.length === 0) {
      const deleted = this.db.delete(schema.mediaMatch).run();
      return deleted.changes;
    }

    const idSet = new Set(allMediaItemIds);
    const allMatches = this.db
      .select({
        id: schema.mediaMatch.id,
        mediaItemId: schema.mediaMatch.mediaItemId,
        matchingItemId: schema.mediaMatch.matchingItemId,
      })
      .from(schema.mediaMatch)
      .all();

    const orphanIds: number[] = [];
    for (const match of allMatches) {
      if (!idSet.has(match.mediaItemId) || !idSet.has(match.matchingItemId)) {
        orphanIds.push(match.id);
      }
    }

    return this.batchDelete(schema.mediaMatch, schema.mediaMatch.id, orphanIds);
  }

  private cleanOrphanedFeatureMatches(): number {
    const allFeatureIds = this.db
      .select({ id: schema.feature.id })
      .from(schema.feature)
      .all()
      .map((r) => r.id);

    if (allFeatureIds.length === 0) {
      const deleted = this.db.delete(schema.featureMatch).run();
      return deleted.changes;
    }

    const idSet = new Set(allFeatureIds);
    const allMatches = this.db
      .select({
        id: schema.featureMatch.id,
        featureId: schema.featureMatch.featureId,
        matchingFeatureId: schema.featureMatch.matchingFeatureId,
      })
      .from(schema.featureMatch)
      .all();

    const orphanIds: number[] = [];
    for (const match of allMatches) {
      if (!idSet.has(match.featureId) || !idSet.has(match.matchingFeatureId)) {
        orphanIds.push(match.id);
      }
    }

    return this.batchDelete(schema.featureMatch, schema.featureMatch.id, orphanIds);
  }

  private cleanOrphanedKeywords(): number {
    const orphans = this.db
      .select({ id: schema.keyword.id })
      .from(schema.keyword)
      .leftJoin(
        schema.mediaItemKeyword,
        eq(schema.keyword.id, schema.mediaItemKeyword.keywordId),
      )
      .where(isNull(schema.mediaItemKeyword.keywordId))
      .all();

    const ids = orphans.map((r) => r.id);
    return this.batchDelete(schema.keyword, schema.keyword.id, ids);
  }

  private cleanOrphanedPersons(): number {
    const allPersons = this.db
      .select({ id: schema.person.id })
      .from(schema.person)
      .all();

    const orphanIds: number[] = [];

    for (const p of allPersons) {
      const hasName = this.db
        .select({ id: schema.personName.id })
        .from(schema.personName)
        .where(eq(schema.personName.personId, p.id))
        .limit(1)
        .get();

      if (hasName) continue;

      const hasFeature = this.db
        .select({ id: schema.personFeature.id })
        .from(schema.personFeature)
        .where(eq(schema.personFeature.personId, p.id))
        .limit(1)
        .get();

      if (hasFeature) continue;

      const hasUser = this.db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.personId, p.id))
        .limit(1)
        .get();

      if (hasUser) continue;

      orphanIds.push(p.id);
    }

    return this.batchDelete(schema.person, schema.person.id, orphanIds);
  }

  private cleanOrphanedPlaces(): number {
    const allPlaces = this.db
      .select({ id: schema.place.id })
      .from(schema.place)
      .all();

    const orphanIds: number[] = [];

    for (const p of allPlaces) {
      const hasName = this.db
        .select({ id: schema.placeName.id })
        .from(schema.placeName)
        .where(eq(schema.placeName.placeId, p.id))
        .limit(1)
        .get();

      if (hasName) continue;

      const hasMedia = this.db
        .select({ id: schema.placeMedia.id })
        .from(schema.placeMedia)
        .where(eq(schema.placeMedia.placeId, p.id))
        .limit(1)
        .get();

      if (hasMedia) continue;

      const hasAddress = this.db
        .select({ id: schema.address.id })
        .from(schema.address)
        .where(eq(schema.address.placeId, p.id))
        .limit(1)
        .get();

      if (hasAddress) continue;

      orphanIds.push(p.id);
    }

    return this.batchDelete(schema.place, schema.place.id, orphanIds);
  }

  private cleanEmptyFolders(): number {
    let totalDeleted = 0;
    let deletedThisPass: number;

    do {
      deletedThisPass = 0;

      const allFolders = this.db
        .select({ id: schema.folder.id })
        .from(schema.folder)
        .all();

      for (const f of allFolders) {
        const hasEntries = this.db
          .select({ id: schema.folderEntry.id })
          .from(schema.folderEntry)
          .where(eq(schema.folderEntry.folderId, f.id))
          .limit(1)
          .get();

        if (hasEntries) continue;

        const hasChildren = this.db
          .select({ id: schema.folder.id })
          .from(schema.folder)
          .where(eq(schema.folder.parentId, f.id))
          .limit(1)
          .get();

        if (hasChildren) continue;

        this.db.delete(schema.folder).where(eq(schema.folder.id, f.id)).run();
        deletedThisPass++;
      }

      totalDeleted += deletedThisPass;
    } while (deletedThisPass > 0);

    return totalDeleted;
  }

  private batchDelete(table: SQLiteTable, column: SQLiteColumn, ids: number[]): number {
    if (ids.length === 0) return 0;

    const CHUNK_SIZE = 100;
    let deleted = 0;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const result = this.db.delete(table).where(inArray(column, chunk)).run();
      deleted += result.changes;
    }

    return deleted;
  }
}
