import { describe, it, expect, afterEach } from 'vitest';
import { rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, createLoggerFromConfig } from '../../src/utils/logger.js';
import type { Config } from '../../src/config/schema.js';

const TEST_LOG_DIR = join(import.meta.dirname, '.tmp-logger-test');

afterEach(async () => {
  await rm(TEST_LOG_DIR, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('returns a pino logger instance', () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('defaults to info level', () => {
    const logger = createLogger();
    expect(logger.level).toBe('info');
  });

  it('accepts a custom log level', () => {
    const logger = createLogger({ level: 'debug' });
    expect(logger.level).toBe('debug');
  });

  it('accepts silent level to suppress all output', () => {
    const logger = createLogger({ level: 'silent' });
    expect(logger.level).toBe('silent');
  });

  it('sets the logger name when provided', () => {
    const logger = createLogger({ name: 'test-service' });
    expect(logger.bindings().name).toBe('test-service');
  });

  it('creates child loggers that inherit level', () => {
    const logger = createLogger({ level: 'warn' });
    const child = logger.child({ component: 'db' });
    expect(child.level).toBe('warn');
  });

  it('writes to log file when logDir is configured', async () => {
    const logger = createLogger({ logDir: TEST_LOG_DIR, level: 'info' });
    logger.info('file transport test');

    // pino transports are async — flush and wait for write
    await new Promise<void>((resolve) => {
      logger.flush();
      setTimeout(resolve, 200);
    });

    const files = await readdir(TEST_LOG_DIR);
    const logFiles = files.filter((f) => f.endsWith('.log'));
    expect(logFiles.length).toBe(1);

    const date = new Date().toISOString().slice(0, 10);
    expect(logFiles[0]).toBe(`${date}.log`);

    const contents = await readFile(join(TEST_LOG_DIR, logFiles[0]), 'utf-8');
    expect(contents).toContain('file transport test');
  });
});

describe('createLoggerFromConfig', () => {
  it('creates a logger from a Config object', () => {
    const config = {
      logLevel: 'warn',
      logDir: undefined,
    } as Config;

    const logger = createLoggerFromConfig(config);
    expect(logger.level).toBe('warn');
  });

  it('passes logDir from config to enable file transport', async () => {
    const config = {
      logLevel: 'info',
      logDir: TEST_LOG_DIR,
    } as Config;

    const logger = createLoggerFromConfig(config, 'app');
    logger.info('config logger test');

    await new Promise<void>((resolve) => {
      logger.flush();
      setTimeout(resolve, 200);
    });

    const files = await readdir(TEST_LOG_DIR);
    expect(files.some((f) => f.endsWith('.log'))).toBe(true);
  });

  it('sets the logger name when provided', () => {
    const config = { logLevel: 'info' } as Config;
    const logger = createLoggerFromConfig(config, 'my-app');
    expect(logger.bindings().name).toBe('my-app');
  });
});
