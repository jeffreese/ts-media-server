import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp, type App } from '../../src/server/app.js';
import type { Config } from '../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

describe('createApp', () => {
  let app: App;

  afterEach(async () => {
    await app?.close();
  }, 15_000);

  // ---------------------------------------------------------------------------
  // Core setup
  // ---------------------------------------------------------------------------

  it('creates a Fastify instance', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    expect(app.server).toBeDefined();
    expect(typeof app.close).toBe('function');
  });

  it('responds to requests after listen', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.listen({ port: 0 });

    const response = await app.server.inject({ method: 'GET', url: '/nonexistent' });
    expect(response.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  it('includes CORS headers on responses', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test', async () => ({ ok: true }));
    await app.server.ready();

    const response = await app.server.inject({
      method: 'GET',
      url: '/test',
      headers: { origin: 'http://example.com' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('handles CORS preflight OPTIONS requests', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test', async () => ({ ok: true }));
    await app.server.ready();

    const response = await app.server.inject({
      method: 'OPTIONS',
      url: '/test',
      headers: {
        origin: 'http://example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  it('decorates the instance with jwt utilities', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    expect(app.server.jwt).toBeDefined();
    expect(typeof app.server.jwt.sign).toBe('function');
    expect(typeof app.server.jwt.verify).toBe('function');
  });

  it('signs and verifies JWT tokens', async () => {
    const config = makeConfig({
      jwt: { secret: 'test-secret', expiresIn: '1h' },
    });
    app = await createApp({ config, loggerOptions });
    await app.server.ready();

    const token = app.server.jwt.sign({ userId: 42 });
    const decoded = app.server.jwt.verify<{ userId: number }>(token);
    expect(decoded.userId).toBe(42);
  });

  it('uses configurable JWT secret', async () => {
    const config = makeConfig({
      jwt: { secret: 'custom-secret', expiresIn: '1h' },
    });
    app = await createApp({ config, loggerOptions });
    await app.server.ready();

    const token = app.server.jwt.sign({ test: true });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  it('registers the WebSocket plugin', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    expect(app.server.websocketServer).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Multipart
  // ---------------------------------------------------------------------------

  it('registers the multipart plugin', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    expect(app.server.multipartErrors).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Static file serving
  // ---------------------------------------------------------------------------

  describe('static file serving', () => {
    let webDir: string;

    beforeEach(() => {
      webDir = mkdtempSync(join(tmpdir(), 'app-test-web-'));
      writeFileSync(join(webDir, 'index.html'), '<h1>hello</h1>');
      mkdirSync(join(webDir, 'assets'));
      writeFileSync(join(webDir, 'assets', 'style.css'), 'body {}');
    });

    it('serves files from the web directory', async () => {
      app = await createApp({ config: makeConfig({ webDir }), loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/index.html' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<h1>hello</h1>');
    });

    it('serves nested files', async () => {
      app = await createApp({ config: makeConfig({ webDir }), loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/assets/style.css' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('body {}');
    });

    it('returns 404 for missing files', async () => {
      app = await createApp({ config: makeConfig({ webDir }), loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({ method: 'GET', url: '/missing.txt' });
      expect(response.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // No webDir
  // ---------------------------------------------------------------------------

  it('works without a webDir configured', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  it('close() shuts down the server cleanly', async () => {
    const localApp = await createApp({ config: makeConfig(), loggerOptions });
    await localApp.server.listen({ port: 0 });

    await localApp.close();

    const addresses = localApp.server.addresses();
    expect(addresses).toHaveLength(0);
  });
});
