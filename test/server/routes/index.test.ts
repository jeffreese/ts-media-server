import { describe, it, expect, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import * as schema from '../../../src/db/schema.js';
import type { Config } from '../../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    jwt: { secret: 'test-secret', expiresIn: '1h' },
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

interface FolderTree {
  rootId: number;
  childIds: Record<string, number>;
}

/**
 * Create a folder hierarchy and seed media items into them.
 *
 *   Photos/
 *     2023/
 *       img-2023 (media item)
 *     2024/
 *       img-2024-a (media item)
 *       img-2024-b (media item)
 */
function seedFolderTree(client: DatabaseClient): FolderTree {
  const db = drizzle(client.db, { schema });

  const root = db.insert(schema.folder).values({ name: 'Photos' }).returning().get();
  const child2023 = db.insert(schema.folder).values({ name: '2023', parentId: root.id }).returning().get();
  const child2024 = db.insert(schema.folder).values({ name: '2024', parentId: root.id }).returning().get();

  const item2023 = db.insert(schema.mediaItem).values({ name: 'img-2023', type: 'image' }).returning().get();
  db.insert(schema.folderEntry).values({ folderId: child2023.id, itemId: item2023.id, index: 0 }).run();

  const item2024a = db.insert(schema.mediaItem).values({ name: 'img-2024-a', type: 'image' }).returning().get();
  db.insert(schema.folderEntry).values({ folderId: child2024.id, itemId: item2024a.id, index: 0 }).run();

  const item2024b = db.insert(schema.mediaItem).values({ name: 'img-2024-b', type: 'video' }).returning().get();
  db.insert(schema.folderEntry).values({ folderId: child2024.id, itemId: item2024b.id, index: 1 }).run();

  return {
    rootId: root.id,
    childIds: {
      '2023': child2023.id,
      '2024': child2024.id,
      'item-2023': item2023.id,
      'item-2024-a': item2024a.id,
      'item-2024-b': item2024b.id,
    },
  };
}

describe('index routes (folder browsing)', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
  });

  describe('GET /index (root)', () => {
    it('lists root-level folders', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.path).toBe('/');
      expect(body.folderId).toBeNull();
      expect(body.folders).toHaveLength(1);
      expect(body.folders[0].name).toBe('Photos');
      expect(body.items).toHaveLength(0);
    });

    it('returns empty results when no folders exist', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.folders).toHaveLength(0);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /index/* (path browsing)', () => {
    it('navigates to a nested folder by path', async () => {
      const client = setupDb();
      const tree = seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index/Photos/2024' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.path).toBe('/Photos/2024');
      expect(body.folderId).toBe(tree.childIds['2024']);
      expect(body.folders).toHaveLength(0);
      expect(body.items).toHaveLength(2);
      expect(body.items[0].name).toBe('img-2024-a');
      expect(body.items[1].name).toBe('img-2024-b');
    });

    it('returns child folders and no items for a parent folder', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index/Photos' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.path).toBe('/Photos');
      expect(body.folders).toHaveLength(2);
      const names = body.folders.map((f: { name: string }) => f.name).sort();
      expect(names).toEqual(['2023', '2024']);
      expect(body.items).toHaveLength(0);
    });

    it('returns 404 for a non-existent folder path', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index/Photos/2025' });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Folder not found');
    });

    it('treats trailing slashes gracefully', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index/Photos/' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.path).toBe('/Photos');
      expect(body.folders).toHaveLength(2);
    });
  });

  describe('recursive listing', () => {
    it('returns all descendants when recursive=true', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos?recursive=true',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.folders).toHaveLength(2);
      expect(body.items).toHaveLength(3);
    });

    it('returns only direct children when recursive is not set', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.folders).toHaveLength(2);
      expect(body.items).toHaveLength(0);
    });

    it('recursive=false behaves like no recursive parameter', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos?recursive=false',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.folders).toHaveLength(2);
      expect(body.items).toHaveLength(0);
    });
  });

  describe('pagination', () => {
    it('paginates results with offset and limit', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos?recursive=true&offset=0&limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(5);
      expect(body.folders.length + body.items.length).toBe(2);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(2);
    });

    it('returns remaining items when offset exceeds available folders', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos?recursive=true&offset=2&limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(5);
      expect(body.items).toHaveLength(3);
      expect(body.folders).toHaveLength(0);
    });

    it('returns empty page when offset is beyond total', async () => {
      const client = setupDb();
      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/index/Photos?recursive=true&offset=100&limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(5);
      expect(body.folders).toHaveLength(0);
      expect(body.items).toHaveLength(0);
    });
  });

  describe('authentication', () => {
    it('requires authentication for /index when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index' });

      expect(response.statusCode).toBe(401);
    });

    it('requires authentication for /index/* when auth is enabled', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      db.update(schema.setting)
        .set({ value: 'enabled' })
        .where(eq(schema.setting.key, 'auth_status'))
        .run();

      seedFolderTree(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index/Photos' });

      expect(response.statusCode).toBe(401);
    });
  });
});
