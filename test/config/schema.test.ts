import { describe, it, expect } from 'vitest';
import { configSchema } from '../../src/config/schema.js';

describe('configSchema', () => {
  it('produces full defaults from an empty object', () => {
    const config = configSchema.parse({});
    expect(config.port).toBe(8080);
    expect(config.database.path).toBe('data/database.sqlite');
    expect(config.thumbnails.sizes).toEqual([
      '1920x1080',
      '1280x720',
      '640x480',
      '300x300',
      '150x100',
    ]);
    expect(config.concurrency).toBeGreaterThan(0);
    expect(config.logLevel).toBe('info');
    expect(config.jwt).toBeUndefined();
    expect(config.webDir).toBeUndefined();
    expect(config.logDir).toBeUndefined();
    expect(config.temp).toBeUndefined();
  });

  it('accepts valid overrides', () => {
    const config = configSchema.parse({
      port: 3000,
      webDir: '/var/www',
      logDir: '/var/log/media',
      temp: '/tmp/media',
      database: { path: '/data/media.db' },
      thumbnails: { sizes: ['640x480', '300x300'] },
      concurrency: 4,
      jwt: { secret: 'test-secret', expiresIn: '1h' },
    });

    expect(config.port).toBe(3000);
    expect(config.webDir).toBe('/var/www');
    expect(config.logDir).toBe('/var/log/media');
    expect(config.temp).toBe('/tmp/media');
    expect(config.database.path).toBe('/data/media.db');
    expect(config.thumbnails.sizes).toEqual(['640x480', '300x300']);
    expect(config.concurrency).toBe(4);
    expect(config.jwt).toEqual({ secret: 'test-secret', expiresIn: '1h' });
  });

  it('applies jwt.expiresIn default when only secret is provided', () => {
    const config = configSchema.parse({ jwt: { secret: 'my-secret' } });
    expect(config.jwt?.expiresIn).toBe('24h');
  });

  it('rejects port out of range', () => {
    expect(() => configSchema.parse({ port: 0 })).toThrow();
    expect(() => configSchema.parse({ port: 70000 })).toThrow();
    expect(() => configSchema.parse({ port: -1 })).toThrow();
  });

  it('rejects non-integer port', () => {
    expect(() => configSchema.parse({ port: 3.5 })).toThrow();
  });

  it('rejects invalid thumbnail size format', () => {
    expect(() =>
      configSchema.parse({ thumbnails: { sizes: ['invalid'] } }),
    ).toThrow();
    expect(() =>
      configSchema.parse({ thumbnails: { sizes: ['1920'] } }),
    ).toThrow();
  });

  it('rejects non-positive concurrency', () => {
    expect(() => configSchema.parse({ concurrency: 0 })).toThrow();
    expect(() => configSchema.parse({ concurrency: -2 })).toThrow();
  });

  it('rejects empty jwt secret', () => {
    expect(() => configSchema.parse({ jwt: { secret: '' } })).toThrow();
  });

  it('accepts valid log levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']) {
      const config = configSchema.parse({ logLevel: level });
      expect(config.logLevel).toBe(level);
    }
  });

  it('rejects invalid log level', () => {
    expect(() => configSchema.parse({ logLevel: 'verbose' })).toThrow();
  });
});
