import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

function buildMultipart(
  fields: Array<{ name: string; value: string } | { name: string; filename: string; content: Buffer; contentType?: string }>,
): { body: Buffer; boundary: string } {
  const boundary = '----TestBoundary' + Date.now();
  const parts: Buffer[] = [];

  for (const field of fields) {
    if ('filename' in field) {
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\nContent-Type: ${field.contentType ?? 'application/octet-stream'}\r\n\r\n`;
      parts.push(Buffer.from(header));
      parts.push(field.content);
      parts.push(Buffer.from('\r\n'));
    } else {
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n`;
      parts.push(Buffer.from(header));
      parts.push(Buffer.from(field.value));
      parts.push(Buffer.from('\r\n'));
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

describe('dir routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;
  let tempDir: string;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  function enableAuth(client: DatabaseClient): void {
    const db = drizzle(client.db, { schema });
    db.update(schema.setting)
      .set({ value: 'enabled' })
      .where(eq(schema.setting.key, 'auth_status'))
      .run();
  }

  function getAdminToken(): string {
    return app.server.jwt.sign({ userId: 1 });
  }

  function createNonAdminUser(client: DatabaseClient): number {
    const db = drizzle(client.db, { schema });
    const person = db.insert(schema.person).values({}).returning().get();
    const user = db.insert(schema.user)
      .values({ personId: person.id, status: 'active' })
      .returning()
      .get();
    return user.id;
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dir-routes-'));
  });

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // GET /dir
  // ---------------------------------------------------------------------------

  describe('GET /dir', () => {
    it('lists files and directories at a given path', async () => {
      await writeFile(join(tempDir, 'photo.jpg'), 'fake jpeg');
      await writeFile(join(tempDir, 'notes.txt'), 'hello');
      mkdirSync(join(tempDir, 'subdir'));

      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(tempDir)}`,
      });

      expect(response.statusCode).toBe(200);
      const entries = response.json();
      expect(entries).toBeInstanceOf(Array);
      expect(entries.length).toBe(3);

      const dirEntry = entries.find((e: { name: string }) => e.name === 'subdir');
      expect(dirEntry).toBeDefined();
      expect(dirEntry.type).toBe('directory');

      const fileEntry = entries.find((e: { name: string }) => e.name === 'photo.jpg');
      expect(fileEntry).toBeDefined();
      expect(fileEntry.type).toBe('file');
      expect(fileEntry.extension).toBe('jpg');
      expect(fileEntry.size).toBeGreaterThan(0);
    });

    it('sorts directories before files', async () => {
      await writeFile(join(tempDir, 'zebra.txt'), 'data');
      mkdirSync(join(tempDir, 'alpha'));

      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(tempDir)}`,
      });

      const entries = response.json();
      expect(entries[0].type).toBe('directory');
      expect(entries[1].type).toBe('file');
    });

    it('returns 404 for a non-existent path', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/dir?path=%2Fnonexistent_dir_12345',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for a path that is a file, not a directory', async () => {
      const filePath = join(tempDir, 'afile.txt');
      await writeFile(filePath, 'data');

      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(filePath)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('not a directory');
    });

    it('returns 400 when path query parameter is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/dir',
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects paths containing traversal segments', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent('/tmp/../etc')}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('traversal');
    });

    it('requires SysAdmin access when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const nonAdminId = createNonAdminUser(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: nonAdminId });
      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(tempDir)}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('SysAdmin');
    });

    it('allows SysAdmin users to list directories', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(tempDir)}`,
        headers: { authorization: `Bearer ${getAdminToken()}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('requires authentication when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir?path=${encodeURIComponent(tempDir)}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /dir/upload
  // ---------------------------------------------------------------------------

  describe('POST /dir/upload', () => {
    it('uploads a file to the specified directory', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const uploadDir = join(tempDir, 'uploads');
      const fileContent = Buffer.from('test file content');
      const { body, boundary } = buildMultipart([
        { name: 'path', value: uploadDir },
        { name: 'file', filename: 'test.txt', content: fileContent },
      ]);

      const response = await app.server.inject({
        method: 'POST',
        url: '/dir/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.uploaded).toHaveLength(1);
      expect(result.uploaded[0]).toBe(join(uploadDir, 'test.txt'));

      const written = await readFile(join(uploadDir, 'test.txt'), 'utf8');
      expect(written).toBe('test file content');
    });

    it('uploads multiple files', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const { body, boundary } = buildMultipart([
        { name: 'path', value: tempDir },
        { name: 'file', filename: 'a.txt', content: Buffer.from('aaa') },
        { name: 'file', filename: 'b.txt', content: Buffer.from('bbb') },
      ]);

      const response = await app.server.inject({
        method: 'POST',
        url: '/dir/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().uploaded).toHaveLength(2);
    });

    it('returns 400 when path field is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const { body, boundary } = buildMultipart([
        { name: 'file', filename: 'test.txt', content: Buffer.from('data') },
      ]);

      const response = await app.server.inject({
        method: 'POST',
        url: '/dir/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects paths with traversal segments', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const { body, boundary } = buildMultipart([
        { name: 'path', value: '/tmp/../etc' },
        { name: 'file', filename: 'test.txt', content: Buffer.from('data') },
      ]);

      const response = await app.server.inject({
        method: 'POST',
        url: '/dir/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('traversal');
    });

    it('requires SysAdmin access when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const nonAdminId = createNonAdminUser(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: nonAdminId });
      const { body, boundary } = buildMultipart([
        { name: 'path', value: tempDir },
        { name: 'file', filename: 'test.txt', content: Buffer.from('data') },
      ]);

      const response = await app.server.inject({
        method: 'POST',
        url: '/dir/upload',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /dir/download
  // ---------------------------------------------------------------------------

  describe('GET /dir/download', () => {
    it('downloads a file from the server', async () => {
      const filePath = join(tempDir, 'download-me.txt');
      await writeFile(filePath, 'file content here');

      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent(filePath)}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/octet-stream');
      expect(response.headers['content-disposition']).toContain('download-me.txt');
      expect(response.body).toBe('file content here');
    });

    it('returns 404 for a non-existent file', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent('/nonexistent_file_12345.txt')}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for a path that is a directory', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent(tempDir)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('not a file');
    });

    it('returns 400 when path query parameter is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/dir/download',
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects paths with traversal segments', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent('/tmp/../etc/passwd')}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('traversal');
    });

    it('requires SysAdmin access when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      const nonAdminId = createNonAdminUser(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const filePath = join(tempDir, 'secret.txt');
      await writeFile(filePath, 'secret data');

      const token = app.server.jwt.sign({ userId: nonAdminId });
      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent(filePath)}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('allows SysAdmin users to download files', async () => {
      const client = setupDb();
      enableAuth(client);

      const filePath = join(tempDir, 'admin-file.txt');
      await writeFile(filePath, 'admin content');

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/dir/download?path=${encodeURIComponent(filePath)}`,
        headers: { authorization: `Bearer ${getAdminToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('admin content');
    });
  });
});
