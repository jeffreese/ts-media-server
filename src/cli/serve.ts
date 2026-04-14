import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { loadConfig } from '../config/config.js';
import { createDatabaseClient } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import * as schema from '../db/schema.js';
import { NotificationService } from '../services/notification.js';
import { FileIndex } from '../services/file-index.js';
import { MediaLogService } from '../services/media-log.js';
import { loadModels, type OnnxModels } from '../services/onnx-models.js';
import { FFmpeg } from '../utils/ffmpeg.js';
import { createMediaFilter } from '../utils/file.js';
import { createApp } from '../server/app.js';
import { configureSharp } from '../utils/image.js';
import { createLoggerFromConfig } from '../utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

interface ServeOptions {
  port?: string;
  config?: string;
  web?: string;
}

function getSetting(
  db: ReturnType<typeof drizzle<typeof schema>>,
  key: string,
): string | undefined {
  const row = db
    .select({ value: schema.setting.value })
    .from(schema.setting)
    .where(eq(schema.setting.key, key))
    .get();
  return row?.value ?? undefined;
}

/** Commander command: run the HTTP API, optional static web root, and WebSocket notifications. */
export const serveCommand = new Command('serve')
  .description('Start the media server')
  .option('-p, --port <number>', 'port to listen on')
  .option('-c, --config <path>', 'path to config file')
  .option('-w, --web <path>', 'path to web directory')
  .action(async (options: ServeOptions) => {
    let models: OnnxModels | undefined;

    try {
      const overrides: Record<string, unknown> = {};
      if (options.port) overrides.port = Number(options.port);
      if (options.web) overrides.webDir = options.web;

      const config = await loadConfig({ configPath: options.config, overrides });
      const logger = createLoggerFromConfig(config, 'media-server');
      configureSharp(config.sharpConcurrency);

      const client = createDatabaseClient({ path: config.database.path });
      runMigrations(client);
      seedDatabase(client);

      const db = drizzle(client.db, { schema });
      const notificationService = new NotificationService();

      const ffmpegPath = getSetting(db, 'ffmpegPath');
      const ffprobePath = getSetting(db, 'ffprobePath');
      const ffmpeg = new FFmpeg({
        ffmpegPath: ffmpegPath ?? undefined,
        ffprobePath: ffprobePath ?? undefined,
      });

      try {
        await ffmpeg.validate();
      } catch {
        logger.warn('FFmpeg not available — indexing from the admin panel will be disabled');
      }

      const detectionModelPath = getSetting(db, 'faceDetectionModelPath');
      const recognitionModelPath = getSetting(db, 'faceRecognitionModelPath');

      if (detectionModelPath && recognitionModelPath) {
        try {
          models = await loadModels({
            detection: detectionModelPath,
            recognition: recognitionModelPath,
          });
          logger.info('ONNX face models loaded');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Face models unavailable, indexing will skip face detection: ${message}`);
        }
      }

      const mediaLog = new MediaLogService(db);

      const fileIndex = new FileIndex({
        db,
        ffmpeg,
        notifications: notificationService,
        logger,
        detectionSession: models?.detection,
        recognitionSession: models?.recognition,
        mediaLog,
      });

      const onIndexDirectory = (directory: string, concurrency: number) => {
        const fileFilter = createMediaFilter();
        fileIndex
          .addDirectory({ directory, fileFilter, concurrency })
          .then(() => logger.info({ directory }, 'indexing complete'))
          .catch((err) => logger.error({ err, directory }, 'indexing failed'));
      };

      const { server, close } = await createApp({
        config,
        db: client.db,
        notificationService,
        onIndexDirectory,
        loggerOptions: { level: config.logLevel, name: 'media-server' },
      });

      let shuttingDown = false;

      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;

        server.log.info({ signal }, 'shutdown signal received');

        const forceExit = setTimeout(() => {
          server.log.error('graceful shutdown timed out — forcing exit');
          process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();

        try {
          await close();
          notificationService.removeAllListeners();
          await models?.dispose();
          client.db.close();
          server.log.info('shutdown complete');
        } catch (err) {
          server.log.error({ err }, 'error during shutdown');
          process.exit(1);
        }

        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      await server.listen({ port: config.port, host: '0.0.0.0' });
      server.log.info({ port: config.port }, `media server listening on http://localhost:${config.port}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`fatal: ${message}`);
      process.exit(1);
    }
  });
