import { describe, it, expect, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';

describe('runMigrations', () => {
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
  });

  it('creates all 37 application tables', () => {
    const client = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    runMigrations(client);

    const tables = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('media_item');
    expect(tableNames).toContain('file');
    expect(tableNames).toContain('path');
    expect(tableNames).toContain('host');
    expect(tableNames).toContain('folder');
    expect(tableNames).toContain('folder_entry');
    expect(tableNames).toContain('feature');
    expect(tableNames).toContain('feature_match');
    expect(tableNames).toContain('person');
    expect(tableNames).toContain('person_name');
    expect(tableNames).toContain('place');
    expect(tableNames).toContain('place_name');
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('user_access');
    expect(tableNames).toContain('user_group');
    expect(tableNames).toContain('component');
    expect(tableNames).toContain('setting');
    expect(tableNames).toContain('data');
    expect(tableNames).toContain('datatype');
    expect(tableNames).toContain('face_rejection');
    expect(tableNames.length).toBe(37);
  });

  it('creates unique indexes', () => {
    const client = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    runMigrations(client);

    const indexes = client.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('path_dir_host_idx');
    expect(indexNames).toContain('file_path_name_ext_idx');
    expect(indexNames).toContain('folder_name_parent_idx');
    expect(indexNames).toContain('component_key_unique');
    expect(indexNames).toContain('setting_key_unique');
  });

  it('is idempotent — running twice does not throw', () => {
    const client = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    runMigrations(client);
    expect(() => runMigrations(client)).not.toThrow();
  });

  it('tracks applied migrations in __drizzle_migrations', () => {
    const client = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    runMigrations(client);

    const migrations = client.db
      .prepare('SELECT * FROM __drizzle_migrations')
      .all() as Array<{ hash: string; created_at: number }>;

    expect(migrations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('seedDatabase', () => {
  const clients: DatabaseClient[] = [];

  function tracked(client: DatabaseClient): DatabaseClient {
    clients.push(client);
    return client;
  }

  function setup(): { client: DatabaseClient; db: ReturnType<typeof drizzle> } {
    const client = tracked(
      createDatabaseClient({ path: ':memory:', enableSpatialite: false }),
    );
    runMigrations(client);
    return { client, db: drizzle(client.db, { schema }) };
  }

  afterEach(() => {
    for (const client of clients) {
      client.db.close();
    }
    clients.length = 0;
  });

  it('creates the four default components', () => {
    const { client, db } = setup();
    seedDatabase(client);

    const components = db.select().from(schema.component).all();
    const keys = components.map((c) => c.key);

    expect(keys).toEqual(['SysAdmin', 'UserAdmin', 'Media', 'Contact']);
  });

  it('creates a default person with preferred name "Admin"', () => {
    const { client, db } = setup();
    seedDatabase(client);

    const names = db.select().from(schema.personName).all();
    expect(names).toHaveLength(1);
    expect(names[0].name).toBe('Admin');
    expect(names[0].preferred).toBe(true);
  });

  it('creates a default user linked to the default person', () => {
    const { client, db } = setup();
    seedDatabase(client);

    const users = db.select().from(schema.user).all();
    expect(users).toHaveLength(1);
    expect(users[0].status).toBe('active');

    const persons = db.select().from(schema.person).all();
    expect(users[0].personId).toBe(persons[0].id);
  });

  it('grants admin access on all four components to the default user', () => {
    const { client, db } = setup();
    seedDatabase(client);

    const access = db.select().from(schema.userAccess).all();
    expect(access).toHaveLength(4);
    for (const a of access) {
      expect(a.level).toBe(5);
    }
  });

  it('seeds the setting table with db_date and auth_status', () => {
    const { client, db } = setup();
    seedDatabase(client);

    const settings = db.select().from(schema.setting).all();
    const keys = settings.map((s) => s.key);

    expect(keys).toContain('db_date');
    expect(keys).toContain('auth_status');

    const authSetting = settings.find((s) => s.key === 'auth_status');
    expect(authSetting?.value).toBe('disabled');
  });

  it('is idempotent — running twice does not duplicate records', () => {
    const { client, db } = setup();
    seedDatabase(client);
    seedDatabase(client);

    const components = db.select().from(schema.component).all();
    expect(components).toHaveLength(4);

    const users = db.select().from(schema.user).all();
    expect(users).toHaveLength(1);
  });
});
