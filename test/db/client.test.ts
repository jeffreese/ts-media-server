import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDatabaseClient,
  findSpatialiteExtension,
  type DatabaseClient,
} from '../../src/db/client.js';

const TEST_DIR = join(import.meta.dirname, '.tmp-db-test');

describe('createDatabaseClient', () => {
  const clients: DatabaseClient[] = [];

  function tracked(client: DatabaseClient): DatabaseClient {
    clients.push(client);
    return client;
  }

  afterEach(() => {
    for (const client of clients) {
      client.db.close();
    }
    clients.length = 0;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('opens an in-memory database', () => {
    const { db } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    expect(db.open).toBe(true);
  });

  // In-memory SQLite databases can't use WAL — they always report "memory" journal mode.
  it('enables WAL journal mode', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const dbPath = join(TEST_DIR, 'wal.db');
    const { db } = tracked(
      createDatabaseClient({ path: dbPath, enableSpatialite: false }),
    );
    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('sets busy_timeout pragma', () => {
    const { db } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    const result = db.pragma('busy_timeout') as { timeout: number }[];
    expect(result[0].timeout).toBe(5000);
  });

  it('enables foreign keys', () => {
    const { db } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it('sets synchronous to NORMAL', () => {
    const { db } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    const result = db.pragma('synchronous') as { synchronous: number }[];
    expect(result[0].synchronous).toBe(1);
  });

  it('increases cache_size to 64MB', () => {
    const { db } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    const result = db.pragma('cache_size') as { cache_size: number }[];
    expect(result[0].cache_size).toBe(-64000);
  });

  it('creates parent directories for file-based databases', () => {
    const dbPath = join(TEST_DIR, 'nested', 'dir', 'test.db');
    const { db } = tracked(
      createDatabaseClient({ path: dbPath, enableSpatialite: false }),
    );
    expect(db.open).toBe(true);
  });

  it('opens a file-based database', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const dbPath = join(TEST_DIR, 'test.db');
    const { db } = tracked(
      createDatabaseClient({ path: dbPath, enableSpatialite: false }),
    );

    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO test (name) VALUES (?)').run('hello');
    const row = db.prepare('SELECT name FROM test').get() as { name: string };
    expect(row.name).toBe('hello');
  });

  it('reports spatialiteLoaded as false when spatialite is disabled', () => {
    const { spatialiteLoaded } = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    expect(spatialiteLoaded).toBe(false);
  });

  it('reports spatialiteLoaded as false when extension is not found', () => {
    const { spatialiteLoaded } = tracked(
      createDatabaseClient({
        path: ':memory:',
        enableSpatialite: true,
        spatialitePath: '/nonexistent/mod_spatialite.so',
      }),
    );
    expect(spatialiteLoaded).toBe(false);
  });

  it('handles concurrent reads with WAL mode', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const dbPath = join(TEST_DIR, 'wal-test.db');
    const client1 = tracked(
      createDatabaseClient({ path: dbPath, enableSpatialite: false }),
    );
    const client2 = tracked(
      createDatabaseClient({ path: dbPath, enableSpatialite: false }),
    );

    client1.db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)');
    client1.db.prepare('INSERT INTO items (val) VALUES (?)').run('a');

    const row = client2.db.prepare('SELECT val FROM items').get() as { val: string };
    expect(row.val).toBe('a');
  });
});

describe('findSpatialiteExtension', () => {
  it('returns a string path or undefined', () => {
    const result = findSpatialiteExtension();
    if (result !== undefined) {
      expect(typeof result).toBe('string');
      expect(result).toContain('spatialite');
    } else {
      expect(result).toBeUndefined();
    }
  });
});
