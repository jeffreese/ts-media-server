import { eq, and, ne, sql } from 'drizzle-orm';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import {
  SYSADMIN_KEY,
  USERADMIN_KEY,
  ADMIN_ACCESS_LEVEL,
} from '../db/constants.js';
import { hashPassword } from '../server/auth.js';

type Db = BetterSQLite3Database<typeof schema>;

export type SecurityAction = 'get' | 'list' | 'save' | 'delete';

export interface SecurityContext {
  userId: number;
  db: Db;
}

export interface SecurityResult {
  allowed: boolean;
  reason?: string;
}

const ALLOWED: SecurityResult = { allowed: true };

function denied(reason: string): SecurityResult {
  return { allowed: false, reason };
}

// ---------------------------------------------------------------------------
// Core: access level lookup
// ---------------------------------------------------------------------------

/**
 * Return the user's access level for a given component key.
 * Returns 0 (no access) if no record exists.
 */
export function getAccessLevel(db: Db, userId: number, componentKey: string): number {
  const row = db
    .select({ level: schema.userAccess.level })
    .from(schema.userAccess)
    .innerJoin(schema.component, eq(schema.component.id, schema.userAccess.componentId))
    .where(
      and(
        eq(schema.userAccess.userId, userId),
        eq(schema.component.key, componentKey),
      ),
    )
    .get();

  return row?.level ?? 0;
}

/**
 * Count the number of users who have admin-level access to a component,
 * optionally excluding a specific user.
 */
export function getAdminCount(db: Db, componentKey: string, excludeUserId?: number): number {
  const componentRow = db
    .select({ id: schema.component.id })
    .from(schema.component)
    .where(eq(schema.component.key, componentKey))
    .get();

  if (!componentRow) return 0;

  const query = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.userAccess)
    .where(
      and(
        eq(schema.userAccess.componentId, componentRow.id),
        sql`${schema.userAccess.level} >= ${ADMIN_ACCESS_LEVEL}`,
        ...(excludeUserId !== undefined
          ? [ne(schema.userAccess.userId, excludeUserId)]
          : []),
      ),
    );

  const row = query.get();
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Per-model security checks
// ---------------------------------------------------------------------------

/**
 * User: UserAdmin required to save/delete other users. Cannot delete the
 * last admin.
 */
export function checkUser(
  ctx: SecurityContext,
  action: SecurityAction,
  record?: { id?: number },
): SecurityResult {
  if (action === 'get' || action === 'list') return ALLOWED;

  const targetId = record?.id;
  const isSelf = targetId !== undefined && targetId === ctx.userId;

  if (!isSelf) {
    const level = getAccessLevel(ctx.db, ctx.userId, USERADMIN_KEY);
    if (level < ADMIN_ACCESS_LEVEL) {
      return denied('UserAdmin access required to manage other users');
    }
  }

  if (action === 'delete' && targetId !== undefined) {
    const remaining = getAdminCount(ctx.db, SYSADMIN_KEY, targetId);
    if (remaining === 0) {
      return denied('Cannot delete the last admin user');
    }
  }

  return ALLOWED;
}

/**
 * UserPreference: users can only access their own preferences.
 */
export function checkUserPreference(
  ctx: SecurityContext,
  _action: SecurityAction,
  record?: { userId?: number },
): SecurityResult {
  if (record?.userId !== undefined && record.userId !== ctx.userId) {
    return denied('Users can only access their own preferences');
  }
  return ALLOWED;
}

/**
 * UserAuthentication: enforce BCrypt hashing on password save, require
 * UserAdmin to manage other users' credentials.
 *
 * Async because the CRUD layer calls `hashPasswordField` (BCrypt) alongside
 * this check before persisting.
 */
export async function checkUserAuthentication(
  ctx: SecurityContext,
  action: SecurityAction,
  record?: { userId?: number; key?: string; value?: string },
): Promise<SecurityResult> {
  if (action === 'get' || action === 'list') return ALLOWED;

  const targetUserId = record?.userId;
  const isSelf = targetUserId !== undefined && targetUserId === ctx.userId;

  if (!isSelf) {
    const level = getAccessLevel(ctx.db, ctx.userId, USERADMIN_KEY);
    if (level < ADMIN_ACCESS_LEVEL) {
      return denied('UserAdmin access required to manage other users\' credentials');
    }
  }

  return ALLOWED;
}

/**
 * Hash a plaintext password value in-place on a UserAuthentication record
 * before it is persisted. Returns a new record with the hashed value.
 */
export async function hashPasswordField(
  record: { key?: string; value?: string },
): Promise<{ key?: string; value?: string }> {
  if (record.key === 'password' && record.value) {
    return { ...record, value: await hashPassword(record.value) };
  }
  return record;
}

/**
 * UserAccess: require UserAdmin to modify. Prevent removing the last admin
 * for any component.
 */
export function checkUserAccess(
  ctx: SecurityContext,
  action: SecurityAction,
  record?: { userId?: number; componentId?: number; level?: number },
): SecurityResult {
  if (action === 'get' || action === 'list') return ALLOWED;

  const level = getAccessLevel(ctx.db, ctx.userId, USERADMIN_KEY);
  if (level < ADMIN_ACCESS_LEVEL) {
    return denied('UserAdmin access required to modify access levels');
  }

  if (action === 'save' && record?.userId !== undefined && record?.componentId !== undefined) {
    const newLevel = record.level ?? 0;
    if (newLevel < ADMIN_ACCESS_LEVEL) {
      const comp = ctx.db
        .select({ key: schema.component.key })
        .from(schema.component)
        .where(eq(schema.component.id, record.componentId))
        .get();

      if (comp) {
        const remaining = getAdminCount(ctx.db, comp.key, record.userId);
        if (remaining === 0) {
          return denied(`Cannot remove the last admin for ${comp.key}`);
        }
      }
    }
  }

  if (action === 'delete' && record?.userId !== undefined && record?.componentId !== undefined) {
    const comp = ctx.db
      .select({ key: schema.component.key })
      .from(schema.component)
      .where(eq(schema.component.id, record.componentId))
      .get();

    if (comp) {
      const remaining = getAdminCount(ctx.db, comp.key, record.userId);
      if (remaining === 0) {
        return denied(`Cannot remove the last admin for ${comp.key}`);
      }
    }
  }

  return ALLOWED;
}

/**
 * Component: require SysAdmin for save/delete.
 */
export function checkComponent(
  ctx: SecurityContext,
  action: SecurityAction,
): SecurityResult {
  if (action === 'get' || action === 'list') return ALLOWED;

  const level = getAccessLevel(ctx.db, ctx.userId, SYSADMIN_KEY);
  if (level < ADMIN_ACCESS_LEVEL) {
    return denied('SysAdmin access required to modify components');
  }
  return ALLOWED;
}

/**
 * Datatype: require SysAdmin for save/delete.
 */
export function checkDatatype(
  ctx: SecurityContext,
  action: SecurityAction,
): SecurityResult {
  if (action === 'get' || action === 'list') return ALLOWED;

  const level = getAccessLevel(ctx.db, ctx.userId, SYSADMIN_KEY);
  if (level < ADMIN_ACCESS_LEVEL) {
    return denied('SysAdmin access required to modify datatypes');
  }
  return ALLOWED;
}

/**
 * DataAccess: filter by user group membership, enforce read-only.
 */
export function checkDataAccess(
  ctx: SecurityContext,
  action: SecurityAction,
  record?: { groupId?: number; readOnly?: boolean },
): SecurityResult {
  if (action === 'get' || action === 'list') return ALLOWED;

  const level = getAccessLevel(ctx.db, ctx.userId, SYSADMIN_KEY);
  if (level >= ADMIN_ACCESS_LEVEL) return ALLOWED;

  if (record?.groupId !== undefined) {
    const membership = ctx.db
      .select()
      .from(schema.userGroupUser)
      .where(
        and(
          eq(schema.userGroupUser.userId, ctx.userId),
          eq(schema.userGroupUser.userGroupId, record.groupId),
        ),
      )
      .get();

    if (!membership) {
      return denied('User is not a member of the specified group');
    }

    if (record.readOnly) {
      return denied('Read-only access — modifications are not allowed');
    }
  }

  return ALLOWED;
}

/**
 * UserRating: users can only access their own ratings.
 */
export function checkUserRating(
  ctx: SecurityContext,
  _action: SecurityAction,
  record?: { userId?: number },
): SecurityResult {
  if (record?.userId !== undefined && record.userId !== ctx.userId) {
    return denied('Users can only access their own ratings');
  }
  return ALLOWED;
}

/**
 * Setting: prevent deletion (save/get/list are handled by the settings route).
 */
export function checkSetting(
  _ctx: SecurityContext,
  action: SecurityAction,
): SecurityResult {
  if (action === 'delete') {
    return denied('Settings cannot be deleted');
  }
  return ALLOWED;
}

// ---------------------------------------------------------------------------
// Registry: model name → checker
// ---------------------------------------------------------------------------

type SyncChecker = (
  ctx: SecurityContext,
  action: SecurityAction,
  record?: Record<string, unknown>,
) => SecurityResult;

type AsyncChecker = (
  ctx: SecurityContext,
  action: SecurityAction,
  record?: Record<string, unknown>,
) => Promise<SecurityResult>;

const SYNC_CHECKERS: Record<string, SyncChecker> = {
  user: checkUser as SyncChecker,
  userPreference: checkUserPreference as SyncChecker,
  userRating: checkUserRating as SyncChecker,
  userAccess: checkUserAccess as SyncChecker,
  component: checkComponent as SyncChecker,
  datatype: checkDatatype as SyncChecker,
  dataAccess: checkDataAccess as SyncChecker,
  setting: checkSetting as SyncChecker,
};

const ASYNC_CHECKERS: Record<string, AsyncChecker> = {
  userAuthentication: checkUserAuthentication as AsyncChecker,
};

/**
 * Run the security check for a given model, action, and optional record.
 * Returns `{ allowed: true }` for models without explicit rules.
 */
export async function checkSecurity(
  model: string,
  ctx: SecurityContext,
  action: SecurityAction,
  record?: Record<string, unknown>,
): Promise<SecurityResult> {
  const asyncChecker = ASYNC_CHECKERS[model];
  if (asyncChecker) return asyncChecker(ctx, action, record);

  const syncChecker = SYNC_CHECKERS[model];
  if (syncChecker) return syncChecker(ctx, action, record);

  return ALLOWED;
}
