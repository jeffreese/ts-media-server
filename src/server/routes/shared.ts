import { isAbsolute } from 'node:path';
import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';
import { SYSADMIN_KEY, ADMIN_ACCESS_LEVEL } from '../../db/constants.js';

/**
 * Check whether a user has SysAdmin access at the admin level.
 */
export function hasAdminAccess(
  db: BetterSQLite3Database<typeof schema>,
  userId: number,
): boolean {
  const row = db
    .select({ level: schema.userAccess.level })
    .from(schema.userAccess)
    .innerJoin(schema.component, eq(schema.component.id, schema.userAccess.componentId))
    .where(
      and(
        eq(schema.userAccess.userId, userId),
        eq(schema.component.key, SYSADMIN_KEY),
      ),
    )
    .get();

  return (row?.level ?? 0) >= ADMIN_ACCESS_LEVEL;
}

/**
 * Validate that a path is absolute and contains no directory traversal.
 * Throws if the path is unsafe.
 */
export function assertSafePath(path: string): void {
  if (!isAbsolute(path)) {
    throw new Error(`Path must be absolute: "${path}"`);
  }
  if (path.includes('..')) {
    throw new Error(`Path must not contain traversal segments: "${path}"`);
  }
}
