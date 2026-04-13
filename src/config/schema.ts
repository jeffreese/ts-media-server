import { z } from 'zod/v4';
import { availableParallelism } from 'node:os';

const thumbnailSizeSchema = z.string().regex(
  /^\d+x\d+$/,
  'Thumbnail size must be in WIDTHxHEIGHT format (e.g. "1920x1080")',
);

/** Allowed values for `logLevel` in config and `LOG_LEVEL` env overrides. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Zod schema for the application JSON config file (e.g. `config.json`): server
 * port, static paths, logging, SQLite path, thumbnail sizes, worker limits, and
 * optional JWT settings.
 */
export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8080),
  webDir: z.string().optional(),
  logDir: z.string().optional(),
  logLevel: z.enum(LOG_LEVELS).default('info'),
  temp: z.string().optional(),
  database: z
    .object({
      path: z.string().default('data/database.sqlite'),
    })
    .default({ path: 'data/database.sqlite' }),
  thumbnails: z
    .object({
      sizes: z
        .array(thumbnailSizeSchema)
        .default(['1920x1080', '1280x720', '640x480', '300x300', '150x100']),
    })
    .default({ sizes: ['1920x1080', '1280x720', '640x480', '300x300', '150x100'] }),
  concurrency: z.number().int().min(1).default(Math.max(Math.floor(availableParallelism() / 2), 2)),
  sharpConcurrency: z.number().int().min(1).default(Math.min(availableParallelism(), 4)),
  jwt: z
    .object({
      secret: z.string().min(1),
      expiresIn: z.string().default('24h'),
    })
    .optional(),
});

/** Runtime shape of a config object after `configSchema` parsing (defaults applied). */
export type Config = z.infer<typeof configSchema>;
