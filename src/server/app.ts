import { watch, type FSWatcher } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Config, LogLevel } from '../config/schema.js';
import { authPlugin } from './auth.js';
import { settingsPlugin } from './routes/settings.js';
import { modelCrudPlugin } from './routes/models/index.js';
import { userRoutesPlugin } from './routes/users.js';
import { imagePlugin } from './routes/image.js';
import type { NotificationService } from '../services/notification.js';

const FILE_WATCH_DEBOUNCE_MS = 500;

export interface CreateAppOptions {
  config: Config;
  db?: Database.Database;
  loggerOptions?: { level?: LogLevel; name?: string };
  notificationService?: NotificationService;
}

export interface App {
  server: FastifyInstance;
  close: () => Promise<void>;
}

/**
 * Create and configure a Fastify instance with all plugins registered.
 *
 * Plugin registration order matters — CORS must come before routes so
 * preflight handling is in place, and JWT must be registered before any
 * route that uses `request.jwtVerify`.
 */
export async function createApp(options: CreateAppOptions): Promise<App> {
  const { config, db, loggerOptions, notificationService } = options;

  const server = Fastify({
    logger: {
      level: loggerOptions?.level ?? config.logLevel,
      ...(loggerOptions?.name ? { name: loggerOptions.name } : {}),
    },
  });

  await server.register(fastifyCors);

  let jwtSecret = config.jwt?.secret;
  if (!jwtSecret) {
    jwtSecret = randomBytes(32).toString('base64url');
    server.log.warn('no jwt.secret configured — using a random ephemeral secret (tokens will not survive restarts)');
  }

  await server.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: config.jwt?.expiresIn ?? '24h' },
  });

  await server.register(fastifyWebsocket);
  await server.register(fastifyMultipart);

  if (db) {
    await server.register(authPlugin, { db });
    await server.register(settingsPlugin, { db });
    await server.register(userRoutesPlugin, { db });
    await server.register(modelCrudPlugin, { db, notificationService });
    await server.register(imagePlugin, { db });
  }

  let watcher: FSWatcher | undefined;

  if (config.webDir) {
    await server.register(fastifyStatic, {
      root: config.webDir,
      wildcard: true,
    });

    watcher = watchWebDirectory(config.webDir, server);
  }

  return {
    server,
    close: async () => {
      watcher?.close();
      await server.close();
    },
  };
}

/**
 * Watch the web directory for changes and log when files are modified.
 * Uses a simple debounce to avoid flooding logs during bulk writes.
 */
function watchWebDirectory(dir: string, app: FastifyInstance): FSWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  return watch(dir, { recursive: true }, (_eventType, filename) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      app.log.info({ filename }, 'web directory changed');
    }, FILE_WATCH_DEBOUNCE_MS);
  });
}
