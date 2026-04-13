import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';
import { MediaLogService } from '../../src/services/media-log.js';

function setupDb(): {
  client: DatabaseClient;
  db: BetterSQLite3Database<typeof schema>;
} {
  const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
  runMigrations(client);
  seedDatabase(client);
  return { client, db: drizzle(client.db, { schema }) };
}

function insertMediaItem(db: BetterSQLite3Database<typeof schema>, name = 'test'): number {
  return db
    .insert(schema.mediaItem)
    .values({ name, type: 'image' })
    .returning({ id: schema.mediaItem.id })
    .get().id;
}

describe('MediaLogService', () => {
  let client: DatabaseClient;
  let db: BetterSQLite3Database<typeof schema>;
  let service: MediaLogService;

  beforeEach(() => {
    ({ client, db } = setupDb());
    service = new MediaLogService(db);
  });

  afterEach(() => {
    client.db.close();
  });

  describe('log', () => {
    it('creates a log entry for a create action', () => {
      const itemId = insertMediaItem(db);
      service.log('create', itemId);

      const logs = db.select().from(schema.mediaLog).all();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
      expect(logs[0].itemId).toBe(itemId);
      expect(logs[0].userId).toBe(1);
      expect(logs[0].date).toBeTruthy();
    });

    it('creates a log entry for an update action', () => {
      const itemId = insertMediaItem(db);
      service.log('update', itemId);

      const logs = db.select().from(schema.mediaLog).all();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('update');
      expect(logs[0].itemId).toBe(itemId);
    });

    it('creates a log entry for a delete action', () => {
      const itemId = insertMediaItem(db);
      service.log('delete', itemId);

      const logs = db
        .select()
        .from(schema.mediaLog)
        .where(eq(schema.mediaLog.itemId, itemId))
        .all();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('delete');
    });

    it('uses the provided userId when given', () => {
      const person = db.insert(schema.person).values({}).returning().get();
      const user = db
        .insert(schema.user)
        .values({ personId: person.id, status: 'active' })
        .returning()
        .get();

      const itemId = insertMediaItem(db);
      service.log('create', itemId, user.id);

      const logs = db.select().from(schema.mediaLog).all();
      expect(logs[0].userId).toBe(user.id);
    });

    it('defaults to user ID 1 when no userId is provided', () => {
      const itemId = insertMediaItem(db);
      service.log('create', itemId);

      const logs = db.select().from(schema.mediaLog).all();
      expect(logs[0].userId).toBe(1);
    });

    it('stores an ISO 8601 timestamp', () => {
      const itemId = insertMediaItem(db);
      service.log('create', itemId);

      const logs = db.select().from(schema.mediaLog).all();
      const date = logs[0].date;
      expect(() => new Date(date).toISOString()).not.toThrow();
      expect(new Date(date).toISOString()).toBe(date);
    });

    it('respects a custom default userId', () => {
      const person = db.insert(schema.person).values({}).returning().get();
      const user = db
        .insert(schema.user)
        .values({ personId: person.id, status: 'active' })
        .returning()
        .get();

      const customService = new MediaLogService(db, user.id);
      const itemId = insertMediaItem(db);
      customService.log('create', itemId);

      const logs = db.select().from(schema.mediaLog).all();
      expect(logs[0].userId).toBe(user.id);
    });

    it('accumulates multiple log entries', () => {
      const itemId = insertMediaItem(db);
      service.log('create', itemId);
      service.log('update', itemId);
      service.log('delete', itemId);

      const logs = db
        .select()
        .from(schema.mediaLog)
        .where(eq(schema.mediaLog.itemId, itemId))
        .all();
      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.action)).toEqual(['create', 'update', 'delete']);
    });
  });
});
