import { describe, it, expect, afterEach } from 'vitest';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';
import { ADMIN_ACCESS_LEVEL } from '../../src/db/constants.js';
import {
  getAccessLevel,
  getAdminCount,
  checkUser,
  checkUserPreference,
  checkUserRating,
  checkUserAuthentication,
  checkUserAccess,
  checkComponent,
  checkDatatype,
  checkDataAccess,
  checkMediaAccess,
  checkSetting,
  checkSecurity,
  hashPasswordField,
  type SecurityContext,
} from '../../src/services/security.js';

type Db = BetterSQLite3Database<typeof schema>;

function setupDb(): { client: DatabaseClient; db: Db } {
  const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
  runMigrations(client);
  seedDatabase(client);
  const db = drizzle(client.db, { schema });
  return { client, db };
}

function createNonAdminUser(db: Db): number {
  const person = db.insert(schema.person).values({}).returning().get();
  const user = db.insert(schema.user)
    .values({ personId: person.id, status: 'active' })
    .returning()
    .get();
  return user.id;
}

function ctx(db: Db, userId: number): SecurityContext {
  return { db, userId };
}

describe('security service', () => {
  const clients: DatabaseClient[] = [];

  afterEach(() => {
    for (const c of clients) c.db.close();
    clients.length = 0;
  });

  function setup(): { db: Db; adminId: number; nonAdminId: number } {
    const { client, db } = setupDb();
    clients.push(client);
    const nonAdminId = createNonAdminUser(db);
    return { db, adminId: 1, nonAdminId };
  }

  // -------------------------------------------------------------------------
  // getAccessLevel
  // -------------------------------------------------------------------------

  describe('getAccessLevel', () => {
    it('returns the access level for a user/component pair', () => {
      const { db, adminId } = setup();
      expect(getAccessLevel(db, adminId, 'SysAdmin')).toBe(ADMIN_ACCESS_LEVEL);
    });

    it('returns 0 when no access record exists', () => {
      const { db, nonAdminId } = setup();
      expect(getAccessLevel(db, nonAdminId, 'SysAdmin')).toBe(0);
    });

    it('returns 0 for a non-existent component key', () => {
      const { db, adminId } = setup();
      expect(getAccessLevel(db, adminId, 'NonExistent')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAdminCount
  // -------------------------------------------------------------------------

  describe('getAdminCount', () => {
    it('counts admins for a component', () => {
      const { db } = setup();
      expect(getAdminCount(db, 'SysAdmin')).toBe(1);
    });

    it('excludes a specific user from the count', () => {
      const { db, adminId } = setup();
      expect(getAdminCount(db, 'SysAdmin', adminId)).toBe(0);
    });

    it('returns 0 for a non-existent component', () => {
      const { db } = setup();
      expect(getAdminCount(db, 'NonExistent')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // checkUser
  // -------------------------------------------------------------------------

  describe('checkUser', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkUser(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkUser(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('allows a user to save their own record', () => {
      const { db, nonAdminId } = setup();
      const result = checkUser(ctx(db, nonAdminId), 'save', { id: nonAdminId });
      expect(result.allowed).toBe(true);
    });

    it('denies a non-admin saving another user', () => {
      const { db, adminId, nonAdminId } = setup();
      const result = checkUser(ctx(db, nonAdminId), 'save', { id: adminId });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UserAdmin');
    });

    it('allows a UserAdmin to save another user', () => {
      const { db, adminId, nonAdminId } = setup();
      const result = checkUser(ctx(db, adminId), 'save', { id: nonAdminId });
      expect(result.allowed).toBe(true);
    });

    it('prevents deleting the last admin', () => {
      const { db, adminId } = setup();
      const result = checkUser(ctx(db, adminId), 'delete', { id: adminId });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('last admin');
    });

    it('allows deleting a non-admin user when requester is admin', () => {
      const { db, adminId, nonAdminId } = setup();
      const result = checkUser(ctx(db, adminId), 'delete', { id: nonAdminId });
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkUserPreference
  // -------------------------------------------------------------------------

  describe('checkUserPreference', () => {
    it('allows access to own preferences', () => {
      const { db, nonAdminId } = setup();
      const result = checkUserPreference(ctx(db, nonAdminId), 'save', { userId: nonAdminId });
      expect(result.allowed).toBe(true);
    });

    it('denies access to another user\'s preferences', () => {
      const { db, adminId, nonAdminId } = setup();
      const result = checkUserPreference(ctx(db, nonAdminId), 'get', { userId: adminId });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('own preferences');
    });

    it('allows access when no userId is specified on the record', () => {
      const { db, nonAdminId } = setup();
      const result = checkUserPreference(ctx(db, nonAdminId), 'list');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkUserAuthentication
  // -------------------------------------------------------------------------

  describe('checkUserAuthentication', () => {
    it('allows get and list', async () => {
      const { db, nonAdminId } = setup();
      expect(await checkUserAuthentication(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(await checkUserAuthentication(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('allows saving own credentials', async () => {
      const { db, nonAdminId } = setup();
      const result = await checkUserAuthentication(ctx(db, nonAdminId), 'save', { userId: nonAdminId });
      expect(result.allowed).toBe(true);
    });

    it('denies non-admin saving another user\'s credentials', async () => {
      const { db, adminId, nonAdminId } = setup();
      const result = await checkUserAuthentication(ctx(db, nonAdminId), 'save', { userId: adminId });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UserAdmin');
    });

    it('allows UserAdmin to save another user\'s credentials', async () => {
      const { db, adminId, nonAdminId } = setup();
      const result = await checkUserAuthentication(ctx(db, adminId), 'save', { userId: nonAdminId });
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // hashPasswordField
  // -------------------------------------------------------------------------

  describe('hashPasswordField', () => {
    it('hashes the value when key is "password"', async () => {
      const result = await hashPasswordField({ key: 'password', value: 'secret123' });
      expect(result.key).toBe('password');
      expect(result.value).not.toBe('secret123');
      expect(result.value!.startsWith('$2b$12$')).toBe(true);
    });

    it('does not hash non-password keys', async () => {
      const result = await hashPasswordField({ key: 'apiToken', value: 'abc123' });
      expect(result.value).toBe('abc123');
    });

    it('returns the record unchanged when value is empty', async () => {
      const result = await hashPasswordField({ key: 'password', value: '' });
      expect(result.value).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // checkUserAccess
  // -------------------------------------------------------------------------

  describe('checkUserAccess', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkUserAccess(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkUserAccess(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('denies non-admin from modifying access levels', () => {
      const { db, nonAdminId } = setup();
      const result = checkUserAccess(ctx(db, nonAdminId), 'save', { userId: 1, componentId: 1, level: 5 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UserAdmin');
    });

    it('allows admin to modify access levels', () => {
      const { db, adminId, nonAdminId } = setup();
      const comp = db.select().from(schema.component).where(eq(schema.component.key, 'Media')).get()!;
      const result = checkUserAccess(ctx(db, adminId), 'save', {
        userId: nonAdminId,
        componentId: comp.id,
        level: 3,
      });
      expect(result.allowed).toBe(true);
    });

    it('prevents removing the last admin for a component via save (downgrade)', () => {
      const { db, adminId } = setup();
      const comp = db.select().from(schema.component).where(eq(schema.component.key, 'SysAdmin')).get()!;
      const result = checkUserAccess(ctx(db, adminId), 'save', {
        userId: adminId,
        componentId: comp.id,
        level: 0,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('last admin');
    });

    it('prevents removing the last admin for a component via delete', () => {
      const { db, adminId } = setup();
      const comp = db.select().from(schema.component).where(eq(schema.component.key, 'SysAdmin')).get()!;
      const result = checkUserAccess(ctx(db, adminId), 'delete', {
        userId: adminId,
        componentId: comp.id,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('last admin');
    });

    it('allows downgrade when another admin exists', () => {
      const { db, adminId, nonAdminId } = setup();
      const comp = db.select().from(schema.component).where(eq(schema.component.key, 'SysAdmin')).get()!;

      db.insert(schema.userAccess).values({
        userId: nonAdminId,
        componentId: comp.id,
        level: ADMIN_ACCESS_LEVEL,
      }).run();

      const result = checkUserAccess(ctx(db, adminId), 'save', {
        userId: adminId,
        componentId: comp.id,
        level: 0,
      });
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkComponent
  // -------------------------------------------------------------------------

  describe('checkComponent', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkComponent(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkComponent(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('denies non-admin from saving components', () => {
      const { db, nonAdminId } = setup();
      const result = checkComponent(ctx(db, nonAdminId), 'save');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SysAdmin');
    });

    it('allows SysAdmin to save components', () => {
      const { db, adminId } = setup();
      expect(checkComponent(ctx(db, adminId), 'save').allowed).toBe(true);
    });

    it('denies non-admin from deleting components', () => {
      const { db, nonAdminId } = setup();
      const result = checkComponent(ctx(db, nonAdminId), 'delete');
      expect(result.allowed).toBe(false);
    });

    it('allows SysAdmin to delete components', () => {
      const { db, adminId } = setup();
      expect(checkComponent(ctx(db, adminId), 'delete').allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkDatatype
  // -------------------------------------------------------------------------

  describe('checkDatatype', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkDatatype(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkDatatype(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('denies non-admin from saving datatypes', () => {
      const { db, nonAdminId } = setup();
      const result = checkDatatype(ctx(db, nonAdminId), 'save');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SysAdmin');
    });

    it('allows SysAdmin to save datatypes', () => {
      const { db, adminId } = setup();
      expect(checkDatatype(ctx(db, adminId), 'save').allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkDataAccess
  // -------------------------------------------------------------------------

  describe('checkDataAccess', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkDataAccess(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkDataAccess(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('allows SysAdmin to save regardless of group membership', () => {
      const { db, adminId } = setup();
      const result = checkDataAccess(ctx(db, adminId), 'save', { groupId: 999 });
      expect(result.allowed).toBe(true);
    });

    it('denies non-member from saving data access', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      const result = checkDataAccess(ctx(db, nonAdminId), 'save', { groupId: group.id });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not a member');
    });

    it('allows group member to save data access', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      db.insert(schema.userGroupUser).values({
        userGroupId: group.id,
        userId: nonAdminId,
        isAdmin: false,
      }).run();
      const result = checkDataAccess(ctx(db, nonAdminId), 'save', { groupId: group.id });
      expect(result.allowed).toBe(true);
    });

    it('denies modification when readOnly is true', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      db.insert(schema.userGroupUser).values({
        userGroupId: group.id,
        userId: nonAdminId,
        isAdmin: false,
      }).run();
      const result = checkDataAccess(ctx(db, nonAdminId), 'save', { groupId: group.id, readOnly: true });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only');
    });
  });

  // -------------------------------------------------------------------------
  // checkMediaAccess
  // -------------------------------------------------------------------------

  describe('checkMediaAccess', () => {
    it('allows get and list for any user', () => {
      const { db, nonAdminId } = setup();
      expect(checkMediaAccess(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkMediaAccess(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
    });

    it('allows SysAdmin to save regardless of group membership', () => {
      const { db, adminId } = setup();
      const result = checkMediaAccess(ctx(db, adminId), 'save', { groupId: 999 });
      expect(result.allowed).toBe(true);
    });

    it('denies non-member from saving media access', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      const result = checkMediaAccess(ctx(db, nonAdminId), 'save', { groupId: group.id });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not a member');
    });

    it('allows group member to save media access', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      db.insert(schema.userGroupUser).values({
        userGroupId: group.id,
        userId: nonAdminId,
        isAdmin: false,
      }).run();
      const result = checkMediaAccess(ctx(db, nonAdminId), 'save', { groupId: group.id });
      expect(result.allowed).toBe(true);
    });

    it('denies modification when readOnly is true', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      db.insert(schema.userGroupUser).values({
        userGroupId: group.id,
        userId: nonAdminId,
        isAdmin: false,
      }).run();
      const result = checkMediaAccess(ctx(db, nonAdminId), 'save', { groupId: group.id, readOnly: true });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only');
    });

    it('allows SysAdmin to delete regardless of group membership', () => {
      const { db, adminId } = setup();
      const result = checkMediaAccess(ctx(db, adminId), 'delete', { groupId: 999 });
      expect(result.allowed).toBe(true);
    });

    it('denies non-member from deleting media access', () => {
      const { db, nonAdminId } = setup();
      const group = db.insert(schema.userGroup).values({ name: 'TestGroup' }).returning().get();
      const result = checkMediaAccess(ctx(db, nonAdminId), 'delete', { groupId: group.id });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not a member');
    });
  });

  // -------------------------------------------------------------------------
  // checkSetting
  // -------------------------------------------------------------------------

  describe('checkSetting', () => {
    it('allows get, list, and save', () => {
      const { db, nonAdminId } = setup();
      expect(checkSetting(ctx(db, nonAdminId), 'get')).toEqual({ allowed: true });
      expect(checkSetting(ctx(db, nonAdminId), 'list')).toEqual({ allowed: true });
      expect(checkSetting(ctx(db, nonAdminId), 'save')).toEqual({ allowed: true });
    });

    it('denies delete', () => {
      const { db, nonAdminId } = setup();
      const result = checkSetting(ctx(db, nonAdminId), 'delete');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot be deleted');
    });
  });

  // -------------------------------------------------------------------------
  // checkUserRating
  // -------------------------------------------------------------------------

  describe('checkUserRating', () => {
    it('allows access to own ratings', () => {
      const { db, nonAdminId } = setup();
      const result = checkUserRating(ctx(db, nonAdminId), 'save', { userId: nonAdminId });
      expect(result.allowed).toBe(true);
    });

    it('denies access to another user\'s ratings', () => {
      const { db, adminId, nonAdminId } = setup();
      const result = checkUserRating(ctx(db, nonAdminId), 'get', { userId: adminId });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('own ratings');
    });

    it('allows access when no userId is specified on the record', () => {
      const { db, nonAdminId } = setup();
      const result = checkUserRating(ctx(db, nonAdminId), 'list');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkSecurity (registry dispatch)
  // -------------------------------------------------------------------------

  describe('checkSecurity', () => {
    it('dispatches to the correct checker for known models', async () => {
      const { db, nonAdminId } = setup();
      const result = await checkSecurity('component', ctx(db, nonAdminId), 'save');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('SysAdmin');
    });

    it('dispatches async checkers', async () => {
      const { db, adminId, nonAdminId } = setup();
      const result = await checkSecurity('userAuthentication', ctx(db, nonAdminId), 'save', { userId: adminId });
      expect(result.allowed).toBe(false);
    });

    it('returns allowed for unknown models', async () => {
      const { db, nonAdminId } = setup();
      const result = await checkSecurity('unknownModel', ctx(db, nonAdminId), 'delete');
      expect(result.allowed).toBe(true);
    });
  });
});
