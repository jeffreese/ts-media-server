import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp, type App } from '../../src/server/app.js';
import { hashPassword, verifyPassword } from '../../src/server/auth.js';
import * as schema from '../../src/db/schema.js';
import type { Config } from '../../src/config/schema.js';

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

describe('auth plugin', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  async function setPassword(client: DatabaseClient, userId: number, plaintext: string): Promise<void> {
    const db = drizzle(client.db, { schema });
    const hashed = await hashPassword(plaintext);
    db.insert(schema.userAuthentication)
      .values({ userId, service: 'database', key: 'password', value: hashed })
      .run();
  }

  function enableAuth(client: DatabaseClient): void {
    const db = drizzle(client.db, { schema });
    db.update(schema.setting)
      .set({ value: 'enabled' })
      .where(eq(schema.setting.key, 'auth_status'))
      .run();
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
  });

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------

  describe('POST /auth/login', () => {
    it('returns a JWT for valid credentials', async () => {
      const client = setupDb();
      await setPassword(client, 1, 'secret123');
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Admin', password: 'secret123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeDefined();
      expect(body.token.split('.')).toHaveLength(3);
    });

    it('rejects invalid password', async () => {
      const client = setupDb();
      await setPassword(client, 1, 'secret123');
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Admin', password: 'wrong' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Invalid credentials');
    });

    it('rejects unknown username', async () => {
      const client = setupDb();
      await setPassword(client, 1, 'secret123');
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Nobody', password: 'secret123' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Invalid credentials');
    });

    it('rejects user with no stored password', async () => {
      const client = setupDb();
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Admin', password: 'anything' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when username or password is missing', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const noPassword = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Admin' },
      });
      expect(noPassword.statusCode).toBe(400);

      const noUsername = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { password: 'secret' },
      });
      expect(noUsername.statusCode).toBe(400);
    });

    it('matches username case-insensitively', async () => {
      const client = setupDb();
      await setPassword(client, 1, 'secret123');
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'admin', password: 'secret123' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().token).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/refresh
  // ---------------------------------------------------------------------------

  describe('POST /auth/refresh', () => {
    it('issues a new token for a valid JWT', async () => {
      const client = setupDb();
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const originalToken = app.server.jwt.sign({ userId: 1 });

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { authorization: `Bearer ${originalToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeDefined();
      expect(body.token.split('.')).toHaveLength(3);

      const decoded = app.server.jwt.verify<{ userId: number }>(body.token);
      expect(decoded.userId).toBe(1);
    });

    it('rejects requests without a token', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/refresh',
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects an invalid token', async () => {
      const client = setupDb();
      enableAuth(client);
      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { authorization: 'Bearer invalid.token.here' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // authenticate hook
  // ---------------------------------------------------------------------------

  describe('authenticate hook', () => {
    it('allows access with a valid JWT when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });

      app.server.get('/protected', {
        preHandler: [app.server.authenticate],
      }, async (request) => {
        return { userId: request.userId };
      });
      await app.server.ready();

      const token = app.server.jwt.sign({ userId: 1 });
      const response = await app.server.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().userId).toBe(1);
    });

    it('rejects requests without a token when auth is enabled', async () => {
      const client = setupDb();
      enableAuth(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });

      app.server.get('/protected', {
        preHandler: [app.server.authenticate],
      }, async () => {
        return { ok: true };
      });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
    });

    it('bypasses auth and attaches default user when auth is disabled', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });

      app.server.get('/protected', {
        preHandler: [app.server.authenticate],
      }, async (request) => {
        return { userId: request.userId };
      });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().userId).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // BCrypt helpers
  // ---------------------------------------------------------------------------

  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies a password', async () => {
      const hashed = await hashPassword('mypassword');
      expect(hashed).not.toBe('mypassword');
      expect(hashed.startsWith('$2b$12$')).toBe(true);

      expect(await verifyPassword('mypassword', hashed)).toBe(true);
      expect(await verifyPassword('wrongpassword', hashed)).toBe(false);
    });

    it('produces different hashes for the same input', async () => {
      const hash1 = await hashPassword('same');
      const hash2 = await hashPassword('same');
      expect(hash1).not.toBe(hash2);
    });
  });
});
