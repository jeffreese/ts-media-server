import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/config.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/db/seed.js';
import { NotificationService } from '../../src/services/notification.js';
import { createApp, type App } from '../../src/server/app.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'serve-test-'));
}

describe('serve command wiring', () => {
  let app: App | undefined;
  const tempDirs: string[] = [];
  const clients: DatabaseClient[] = [];

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const client of clients) {
      try { client.db.close(); } catch { /* already closed */ }
    }
    clients.length = 0;
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  }, 15_000);

  it('initializes database, runs migrations, seeds, and starts the server', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const dbPath = join(dir, 'test.sqlite');

    const config = await loadConfig({
      overrides: { database: { path: dbPath }, logLevel: 'silent' },
    });

    const client = createDatabaseClient({ path: config.database.path, enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);

    const notificationService = new NotificationService();

    app = await createApp({
      config,
      db: client.db,
      notificationService,
      loggerOptions: { level: 'silent' },
    });

    await app.server.listen({ port: 0 });

    const response = await app.server.inject({ method: 'GET', url: '/setting/auth_status' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('disabled');
  });

  it('registers websocket event bridge when notificationService is provided', async () => {
    const config = await loadConfig({
      overrides: { logLevel: 'silent' },
    });

    const notificationService = new NotificationService();

    app = await createApp({
      config,
      notificationService,
      loggerOptions: { level: 'silent' },
    });

    await app.server.ready();
    expect(notificationService.listenerCount).toBe(1);
  });

  it('does not register websocket event bridge without notificationService', async () => {
    const config = await loadConfig({
      overrides: { logLevel: 'silent' },
    });

    app = await createApp({
      config,
      loggerOptions: { level: 'silent' },
    });

    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/ws' });
    expect(response.statusCode).toBe(404);
  });

  it('serves static files when webDir is configured', async () => {
    const webDir = makeTempDir();
    tempDirs.push(webDir);
    writeFileSync(join(webDir, 'index.html'), '<h1>media</h1>');

    const config = await loadConfig({
      overrides: { webDir, logLevel: 'silent' },
    });

    app = await createApp({
      config,
      loggerOptions: { level: 'silent' },
    });

    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/index.html' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<h1>media</h1>');
  });

  it('registers all route plugins when db is provided', async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const dbPath = join(dir, 'routes-test.sqlite');

    const config = await loadConfig({
      overrides: { database: { path: dbPath }, logLevel: 'silent' },
    });

    const client = createDatabaseClient({ path: config.database.path, enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);

    app = await createApp({
      config,
      db: client.db,
      loggerOptions: { level: 'silent' },
    });

    await app.server.ready();

    const authResponse = await app.server.inject({ method: 'POST', url: '/auth/login' });
    expect(authResponse.statusCode).not.toBe(404);

    const settingResponse = await app.server.inject({ method: 'GET', url: '/setting/auth_status' });
    expect(settingResponse.statusCode).toBe(200);
  });

  it('shuts down cleanly via close()', async () => {
    const config = await loadConfig({
      overrides: { logLevel: 'silent' },
    });

    const localApp = await createApp({
      config,
      loggerOptions: { level: 'silent' },
    });

    await localApp.server.listen({ port: 0 });
    await localApp.close();
    app = undefined;

    expect(localApp.server.addresses()).toHaveLength(0);
  });
});
