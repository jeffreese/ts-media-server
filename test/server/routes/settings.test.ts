import { describe, it, expect, afterEach, vi } from 'vitest';
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

describe('settings routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

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

  function getAuthToken(): string {
    return app.server.jwt.sign({ userId: 1 });
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // GET /setting/:key
  // ---------------------------------------------------------------------------

  describe('GET /setting/:key', () => {
    it('returns a setting value as plain text', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/setting/auth_status',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toBe('disabled');
    });

    it('returns 404 for a non-existent key', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/setting/nonexistent_key',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('not found');
    });

    it('requires authentication when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/setting/auth_status',
      });

      expect(response.statusCode).toBe(401);
    });

    it('succeeds with a valid token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/setting/auth_status',
        headers: { authorization: `Bearer ${getAuthToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('enabled');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /setting/:key
  // ---------------------------------------------------------------------------

  describe('POST /setting/:key', () => {
    it('updates an existing setting', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/db_date',
        payload: { value: '2025-01-01T00:00:00.000Z' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('2025-01-01T00:00:00.000Z');

      const verify = await app.server.inject({
        method: 'GET',
        url: '/setting/db_date',
      });
      expect(verify.body).toBe('2025-01-01T00:00:00.000Z');
    });

    it('creates a new setting if the key does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/custom_key',
        payload: { value: 'custom_value' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('custom_value');

      const verify = await app.server.inject({
        method: 'GET',
        url: '/setting/custom_key',
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.body).toBe('custom_value');
    });

    it('returns 400 when value is missing from the body', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/auth_status',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('value');
    });

    it('requires SysAdmin access when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);

      const db = drizzle(client.db, { schema });
      const person = db.insert(schema.person).values({}).returning().get();
      const nonAdmin = db.insert(schema.user)
        .values({ personId: person.id, status: 'active' })
        .returning()
        .get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: nonAdmin.id });

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/auth_status',
        headers: { authorization: `Bearer ${token}` },
        payload: { value: 'disabled' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toContain('SysAdmin');
    });

    it('allows SysAdmin users to save settings', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/auth_status',
        headers: { authorization: `Bearer ${getAuthToken()}` },
        payload: { value: 'disabled' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('disabled');
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  describe('validation', () => {
    it('validates ffmpegPath by running -version', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/ffmpegPath',
        payload: { value: '/nonexistent/ffmpeg' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('FFmpeg not found');
    });

    it('validates ffprobePath by running -version', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/ffprobePath',
        payload: { value: '/nonexistent/ffprobe' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('FFmpeg not found');
    });

    it('rejects ONNX model path without .onnx extension', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/faceDetectionModelPath',
        payload: { value: '/some/model.bin' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('.onnx extension');
    });

    it('rejects ONNX model path when file does not exist', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/faceDetectionModelPath',
        payload: { value: '/nonexistent/model.onnx' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('not found or not readable');
    });

    it('rejects ffmpegPath with unexpected basename', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/ffmpegPath',
        payload: { value: '/usr/bin/curl' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('Expected an ffmpeg or ffprobe binary');
    });

    it('rejects paths containing traversal segments', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/faceDetectionModelPath',
        payload: { value: '/models/../etc/passwd.onnx' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('traversal');
    });

    it('rejects non-string value in body', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/auth_status',
        payload: { value: 123 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('does not validate keys that are not in the validated set', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/setting/some_arbitrary_key',
        payload: { value: 'anything' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('anything');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /setting/:key
  // ---------------------------------------------------------------------------

  describe('DELETE /setting/:key', () => {
    it('returns 405 — settings cannot be deleted', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'DELETE',
        url: '/setting/auth_status',
      });

      expect(response.statusCode).toBe(405);
      expect(response.json().error).toContain('cannot be deleted');
    });
  });
});
