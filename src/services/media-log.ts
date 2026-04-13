import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

/** Values written to `media_log.action` for media create/update/delete operations. */
export type MediaLogAction = 'create' | 'update' | 'delete';

const DEFAULT_SYSTEM_USER_ID = 1;

/**
 * Records audit log entries in the `media_log` table whenever media items
 * are created, updated, or deleted.
 *
 * The `userId` defaults to the system admin (user 1) for CLI-driven
 * operations that run outside an authenticated HTTP context.
 */
export class MediaLogService {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly defaultUserId: number = DEFAULT_SYSTEM_USER_ID,
  ) {}

  /**
   * Insert one `media_log` row for the given item.
   *
   * @param userId - Actor id; falls back to `defaultUserId` when omitted (see class JSDoc).
   */
  log(action: MediaLogAction, itemId: number, userId?: number): void {
    const entry: typeof schema.mediaLog.$inferInsert = {
      itemId,
      userId: userId ?? this.defaultUserId,
      date: new Date().toISOString(),
      action,
    };
    this.db.insert(schema.mediaLog).values(entry).run();
  }
}
