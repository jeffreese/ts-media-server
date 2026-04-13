import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod/v4';
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

describe('global error handler', () => {
  let app: App;

  afterEach(async () => {
    await app?.close();
  }, 15_000);

  it('returns structured JSON for unexpected thrown errors', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test/throw', async () => {
      throw new Error('something broke');
    });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/test/throw' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });

  it('does not leak internal error messages to clients', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test/leak', async () => {
      throw new Error('database password is hunter2');
    });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/test/leak' });

    const body = response.json();
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('formats Zod validation errors with field-level details', async () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number(),
    });

    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.post('/test/validate', async (request) => {
      const data = testSchema.parse(request.body);
      return data;
    });
    await app.server.ready();

    const response = await app.server.inject({
      method: 'POST',
      url: '/test/validate',
      payload: { name: '', age: 'not-a-number' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('Validation failed');
    expect(body.details).toBeInstanceOf(Array);
    expect(body.details.length).toBeGreaterThanOrEqual(2);

    const paths = body.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('name');
    expect(paths).toContain('age');

    for (const detail of body.details) {
      expect(detail).toHaveProperty('path');
      expect(detail).toHaveProperty('message');
      expect(detail).toHaveProperty('code');
    }
  });

  it('preserves Fastify built-in error status codes', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    const response = await app.server.inject({
      method: 'POST',
      url: '/test/nonexistent',
      headers: { 'content-type': 'application/json' },
      payload: 'not valid json{{{',
    });

    expect(response.statusCode).toBeLessThan(500);
  });

  it('returns consistent shape for 404 routes without webDir', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/nonexistent' });

    expect(response.statusCode).toBe(404);
  });

  it('returns JSON content-type for error responses', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test/error-type', async () => {
      throw new Error('test');
    });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/test/error-type' });

    expect(response.headers['content-type']).toContain('application/json');
  });

  it('handles errors with a statusCode property (Fastify-style)', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test/fastify-error', async () => {
      const err = new Error('Not Authorized') as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/test/fastify-error' });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(body.message).toBe('Not Authorized');
  });

  it('handles non-Error thrown values', async () => {
    app = await createApp({ config: makeConfig(), loggerOptions });

    app.server.get('/test/throw-string', async () => {
      throw 'raw string error';
    });
    await app.server.ready();

    const response = await app.server.inject({ method: 'GET', url: '/test/throw-string' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
  });
});
