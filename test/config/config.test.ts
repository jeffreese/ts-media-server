import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../src/config/config.js';

const TEST_DIR = join(import.meta.dirname, '.tmp-config-test');

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data));
}

describe('loadConfig', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('returns defaults when config file does not exist', async () => {
    const config = await loadConfig({
      configPath: join(TEST_DIR, 'nonexistent.json'),
    });
    expect(config.port).toBe(8080);
    expect(config.database.path).toContain('database.sqlite');
  });

  it('loads values from a config file', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    await writeJson(configPath, { port: 9090, webDir: '/srv/web' });

    const config = await loadConfig({ configPath });
    expect(config.port).toBe(9090);
    expect(config.webDir).toBe('/srv/web');
  });

  it('resolves relative database path from config file directory', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    await writeJson(configPath, { database: { path: 'my.db' } });

    const config = await loadConfig({ configPath });
    expect(config.database.path).toBe(resolve(TEST_DIR, 'my.db'));
  });

  it('resolves relative webDir from config file directory', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    await writeJson(configPath, { webDir: 'static' });

    const config = await loadConfig({ configPath });
    expect(config.webDir).toBe(resolve(TEST_DIR, 'static'));
  });

  it('preserves absolute paths without modification', async () => {
    const configPath = join(TEST_DIR, 'config.json');
    await writeJson(configPath, {
      webDir: '/absolute/web',
      database: { path: '/absolute/db.sqlite' },
    });

    const config = await loadConfig({ configPath });
    expect(config.webDir).toBe('/absolute/web');
    expect(config.database.path).toBe('/absolute/db.sqlite');
  });

  describe('environment variable overrides', () => {
    it('overrides port from PORT env var', async () => {
      vi.stubEnv('PORT', '4000');
      const configPath = join(TEST_DIR, 'config.json');
      await writeJson(configPath, { port: 9090 });

      const config = await loadConfig({ configPath });
      expect(config.port).toBe(4000);
    });

    it('overrides database path from DATABASE_PATH env var', async () => {
      vi.stubEnv('DATABASE_PATH', '/env/db.sqlite');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.database.path).toBe('/env/db.sqlite');
    });

    it('overrides webDir from WEB_DIR env var', async () => {
      vi.stubEnv('WEB_DIR', '/env/web');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.webDir).toBe('/env/web');
    });

    it('overrides logDir from LOG_DIR env var', async () => {
      vi.stubEnv('LOG_DIR', '/env/logs');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.logDir).toBe('/env/logs');
    });

    it('overrides temp from TEMP_DIR env var', async () => {
      vi.stubEnv('TEMP_DIR', '/env/tmp');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.temp).toBe('/env/tmp');
    });

    it('overrides logLevel from LOG_LEVEL env var', async () => {
      vi.stubEnv('LOG_LEVEL', 'debug');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.logLevel).toBe('debug');
    });

    it('overrides concurrency from CONCURRENCY env var', async () => {
      vi.stubEnv('CONCURRENCY', '2');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.concurrency).toBe(2);
    });

    it('overrides sharpConcurrency from SHARP_CONCURRENCY env var', async () => {
      vi.stubEnv('SHARP_CONCURRENCY', '8');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.sharpConcurrency).toBe(8);
    });

    it('sets jwt.secret from JWT_SECRET env var', async () => {
      vi.stubEnv('JWT_SECRET', 'env-secret');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.jwt?.secret).toBe('env-secret');
    });

    it('sets jwt.expiresIn from JWT_EXPIRES_IN env var', async () => {
      vi.stubEnv('JWT_SECRET', 'env-secret');
      vi.stubEnv('JWT_EXPIRES_IN', '2h');
      const config = await loadConfig({
        configPath: join(TEST_DIR, 'nonexistent.json'),
      });
      expect(config.jwt?.expiresIn).toBe('2h');
    });

    it('env vars take precedence over config file values', async () => {
      vi.stubEnv('PORT', '5555');
      const configPath = join(TEST_DIR, 'config.json');
      await writeJson(configPath, { port: 3000 });

      const config = await loadConfig({ configPath });
      expect(config.port).toBe(5555);
    });

    it('ignores empty env var strings', async () => {
      vi.stubEnv('PORT', '');
      const configPath = join(TEST_DIR, 'config.json');
      await writeJson(configPath, { port: 3000 });

      const config = await loadConfig({ configPath });
      expect(config.port).toBe(3000);
    });

    it('rejects non-numeric PORT env var via Zod', async () => {
      vi.stubEnv('PORT', 'abc');
      await expect(
        loadConfig({ configPath: join(TEST_DIR, 'nonexistent.json') }),
      ).rejects.toThrow();
    });

    it('rejects JWT_EXPIRES_IN without JWT_SECRET', async () => {
      vi.stubEnv('JWT_EXPIRES_IN', '2h');
      await expect(
        loadConfig({ configPath: join(TEST_DIR, 'nonexistent.json') }),
      ).rejects.toThrow();
    });
  });

  describe('validation errors', () => {
    it('throws on invalid JSON in config file', async () => {
      const configPath = join(TEST_DIR, 'bad.json');
      await writeFile(configPath, '{ not json }');

      await expect(loadConfig({ configPath })).rejects.toThrow();
    });

    it('throws on invalid port type in config file', async () => {
      const configPath = join(TEST_DIR, 'config.json');
      await writeJson(configPath, { port: 'not-a-number' });

      await expect(loadConfig({ configPath })).rejects.toThrow();
    });

    it('throws on invalid thumbnail sizes', async () => {
      const configPath = join(TEST_DIR, 'config.json');
      await writeJson(configPath, { thumbnails: { sizes: ['bad'] } });

      await expect(loadConfig({ configPath })).rejects.toThrow();
    });
  });

  describe('custom config path', () => {
    it('loads from a custom config file path', async () => {
      const customPath = join(TEST_DIR, 'custom', 'my-config.json');
      await mkdir(join(TEST_DIR, 'custom'), { recursive: true });
      await writeJson(customPath, { port: 7777 });

      const config = await loadConfig({ configPath: customPath });
      expect(config.port).toBe(7777);
    });

    it('resolves relative paths from the custom config directory', async () => {
      const customDir = join(TEST_DIR, 'custom');
      await mkdir(customDir, { recursive: true });
      const customPath = join(customDir, 'config.json');
      await writeJson(customPath, { database: { path: 'local.db' } });

      const config = await loadConfig({ configPath: customPath });
      expect(config.database.path).toBe(resolve(customDir, 'local.db'));
    });
  });
});
