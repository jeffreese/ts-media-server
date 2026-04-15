import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
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
import { videoPlugin } from './routes/video.js';
import { facePlugin } from './routes/face.js';
import { indexPlugin } from './routes/index.js';
import { thumbnailsPlugin } from './routes/thumbnails.js';
import { mediaItemPlugin } from './routes/media-item.js';
import { mediaItemDetailPlugin } from './routes/media-item-detail.js';
import { dirPlugin } from './routes/dir.js';
import { keywordPlugin } from './routes/keywords.js';
import { ratingPlugin } from './routes/ratings.js';
import { peoplePlugin } from './routes/people.js';
import { placesPlugin } from './routes/places.js';
import { mapPlugin } from './routes/map.js';
import { searchPlugin } from './routes/search.js';
import { adminPlugin, type MaintenanceResult } from './routes/admin.js';
import type { NotificationService } from '../services/notification.js';
import { websocketPlugin } from './websocket.js';
import { errorHandlerPlugin } from './error-handler.js';

const FILE_WATCH_DEBOUNCE_MS = 500;

/**
 * Options for {@link createApp}. When `db` is omitted, database-backed routes
 * and auth are not registered (useful for static-only or test doubles).
 * `notificationService` enables the `/ws` bridge; without it, no WebSocket
 * plugin is registered.
 */
export interface CreateAppOptions {
  config: Config;
  db?: Database.Database;
  loggerOptions?: { level?: LogLevel; name?: string };
  notificationService?: NotificationService;
  onIndexDirectory?: (directory: string, concurrency: number) => void;
  onDeduplicate?: () => Promise<MaintenanceResult['dedup']>;
  onCleanOrphans?: () => Promise<MaintenanceResult['orphans']>;
}

/** Running application: the Fastify server plus {@link App.close} for teardown. */
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
  const { config, db, loggerOptions, notificationService, onIndexDirectory, onDeduplicate, onCleanOrphans } = options;

  const server = Fastify({
    logger: {
      level: loggerOptions?.level ?? config.logLevel,
      ...(loggerOptions?.name ? { name: loggerOptions.name } : {}),
    },
  });

  await server.register(fastifyCors);
  await server.register(errorHandlerPlugin);

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
    await server.register(videoPlugin, { db });
    await server.register(facePlugin, { db });
    await server.register(indexPlugin, { db });
    await server.register(thumbnailsPlugin, { db });
    await server.register(mediaItemPlugin, { db });
    await server.register(mediaItemDetailPlugin, { db });
    await server.register(dirPlugin, { db });
    await server.register(keywordPlugin, { db, notificationService });
    await server.register(ratingPlugin, { db, notificationService });
    await server.register(peoplePlugin, { db, notificationService });
    await server.register(placesPlugin, { db, notificationService });
    await server.register(mapPlugin, { db });
    await server.register(searchPlugin, { db });
    await server.register(adminPlugin, { db, onIndexDirectory, onDeduplicate, onCleanOrphans });
  }

  if (notificationService) {
    await server.register(websocketPlugin, { notificationService });
  }

  let watcher: FSWatcher | undefined;

  if (config.webDir) {
    await server.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
    });

    const indexPath = join(config.webDir, 'index.html');
    server.setNotFoundHandler(async (request, reply) => {
      const hasExtension = /\.\w+$/.test(request.url.split('?')[0] ?? '');
      if (hasExtension) {
        return reply.code(404).send({ error: 'Not found' });
      }

      try {
        const html = await readFile(indexPath, 'utf-8');
        return reply.type('text/html').send(html);
      } catch {
        return reply.code(404).send({ error: 'Not found' });
      }
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
