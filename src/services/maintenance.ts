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
   * Group media items by identical perceptual hash. Returns arrays of
   * media item IDs where each group has 2+ items sharing the same hash.
   * IDs are sorted ascending so the first element is always the keeper.
   */
  private findDuplicateGroups(): number[][] {
    const rows = this.db
      .select({
        hash: schema.mediaItem.hash,
        count: sql<number>`count(*)`,
      })
      .from(schema.mediaItem)
      .where(sql`${schema.mediaItem.hash} is not null AND ${schema.mediaItem.hash} != ''`)
      .groupBy(schema.mediaItem.hash)
      .having(sql`count(*) > 1`)
      .all();

    const groups: number[][] = [];

    for (const row of rows) {
      const items = this.db
        .select({ id: schema.mediaItem.id })
        .from(schema.mediaItem)
        .where(eq(schema.mediaItem.hash, row.hash!))
        .orderBy(schema.mediaItem.id)
        .all();

      if (items.length > 1) {
        groups.push(items.map((i) => i.id));
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
