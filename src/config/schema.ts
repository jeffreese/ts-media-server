import { z } from 'zod/v4';
import { availableParallelism } from 'node:os';

const thumbnailSizeSchema = z.string().regex(
  /^\d+x\d+$/,
  'Thumbnail size must be in WIDTHxHEIGHT format (e.g. "1920x1080")',
);

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

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
  concurrency: z.number().int().min(1).default(availableParallelism()),
  jwt: z
    .object({
      secret: z.string().min(1),
      expiresIn: z.string().default('24h'),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
