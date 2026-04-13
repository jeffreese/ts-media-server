import pino, { type Logger, type LoggerOptions } from 'pino';
import { join } from 'node:path';
import type { Config } from '../config/schema.js';

export type { Logger } from 'pino';

/**
 * Options for {@link createLogger}. When `logDir` is set, logs are mirrored to
 * a daily `YYYY-MM-DD.log` file under that directory in addition to stdout.
 */
export interface CreateLoggerOptions {
  level?: Config['logLevel'];
  logDir?: string;
  name?: string;
}

/**
 * Build pino transport targets from config. When `logDir` is set, logs are
 * written to a date-stamped file in that directory alongside stdout.
 */
function buildTransportTargets(logDir?: string): pino.TransportMultiOptions | undefined {
  if (!logDir) return undefined;

  const date = new Date().toISOString().slice(0, 10);
  const destination = join(logDir, `${date}.log`);

  return {
    targets: [
      { target: 'pino/file', options: { destination: 1 }, level: 'trace' },
      { target: 'pino/file', options: { destination, mkdir: true }, level: 'trace' },
    ],
  };
}

/**
 * Instantiate a root pino logger. Uses multistream transport when `logDir` is
 * provided so trace-through levels go to stdout and to `YYYY-MM-DD.log`.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = 'info', logDir, name } = options;

  const loggerOptions: LoggerOptions = { level };
  if (name) loggerOptions.name = name;

  const transport = buildTransportTargets(logDir);
  if (transport) loggerOptions.transport = transport;

  return pino(loggerOptions);
}

/**
 * Create a logger from the application config. Reads `logLevel` and `logDir`
 * from the config object.
 */
export function createLoggerFromConfig(config: Config, name?: string): Logger {
  return createLogger({
    level: config.logLevel,
    logDir: config.logDir,
    name,
  });
}
