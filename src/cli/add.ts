import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { loadConfig } from '../config/config.js';
import { createDatabaseClient, type DatabaseClient } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import * as schema from '../db/schema.js';
import { FFmpeg } from '../utils/ffmpeg.js';
import { createMediaFilter } from '../utils/file.js';
import { createLoggerFromConfig } from '../utils/logger.js';
import { loadModels, type OnnxModels } from '../services/onnx-models.js';
import { NotificationService, type NotificationEvent } from '../services/notification.js';
import { MediaLogService } from '../services/media-log.js';
import { FileIndex } from '../services/file-index.js';

interface AddDirectoryOptions {
  path: string;
  concurrency?: string;
  config?: string;
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

export const addCommand = new Command('add')
  .description('Add media to the library');

addCommand
  .command('directory')
  .description('Index a directory of media files')
  .requiredOption('--path <path>', 'directory to index')
  .option('--concurrency <number>', 'number of files to process in parallel')
  .option('-c, --config <path>', 'path to config file')
  .action(async (options: AddDirectoryOptions) => {
    let client: DatabaseClient | undefined;
    let models: OnnxModels | undefined;

    try {
      const directory = resolve(options.path);

      if (!existsSync(directory)) {
        console.error(`error: directory does not exist: ${directory}`);
        process.exit(1);
      }
      if (!statSync(directory).isDirectory()) {
        console.error(`error: path is not a directory: ${directory}`);
        process.exit(1);
      }

      const overrides: Record<string, unknown> = {};
      if (options.concurrency) overrides.concurrency = Number(options.concurrency);

      const config = await loadConfig({ configPath: options.config, overrides });
      const logger = createLoggerFromConfig(config, 'add-directory');

      client = createDatabaseClient({ path: config.database.path });
      runMigrations(client);
      seedDatabase(client);

      const db = drizzle(client.db, { schema });

      const ffmpegPath = getSetting(db, 'ffmpegPath');
      const ffprobePath = getSetting(db, 'ffprobePath');
      const ffmpeg = new FFmpeg({
        ffmpegPath: ffmpegPath ?? undefined,
        ffprobePath: ffprobePath ?? undefined,
      });
      await ffmpeg.validate();

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
          logger.warn(`Face models unavailable, skipping face detection: ${message}`);
        }
      } else {
        logger.info('Face model paths not configured — skipping face detection');
      }

      const notificationService = new NotificationService();
      const mediaLog = new MediaLogService(db);

      let filesIndexed = 0;
      let totalFiles = 0;

      const dispose = notificationService.addListener((event: NotificationEvent) => {
        if (event.action !== 'progress' || event.source !== 'fileIndex') return;

        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;

        switch (data.phase) {
          case 'scanning':
            console.log(`Scanning ${data.directory as string}…`);
            break;
          case 'registering_files':
            console.log('Registering files…');
            break;
          case 'indexing': {
            totalFiles = data.total as number;
            filesIndexed = data.processed as number;
            const pct = totalFiles > 0 ? Math.round((filesIndexed / totalFiles) * 100) : 0;
            process.stdout.write(`\rProcessing: ${filesIndexed}/${totalFiles} (${pct}%)`);
            break;
          }
          case 'complete':
            if (totalFiles > 0) process.stdout.write('\n');
            break;
        }
      });

      const concurrency = options.concurrency
        ? Number(options.concurrency)
        : config.concurrency;

      const fileIndex = new FileIndex({
        db,
        ffmpeg,
        notifications: notificationService,
        logger,
        detectionSession: models?.detection,
        recognitionSession: models?.recognition,
        mediaLog,
      });

      const fileFilter = createMediaFilter();

      await fileIndex.addDirectory({
        directory,
        fileFilter,
        concurrency,
      });

      dispose();

      const mediaItemCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.mediaItem).get()?.count ?? 0,
      );
      const featureCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.feature).get()?.count ?? 0,
      );
      const matchCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.mediaMatch).get()?.count ?? 0,
      );

      console.log('\nIndexing complete:');
      console.log(`  Files indexed:  ${filesIndexed}`);
      console.log(`  Media items:    ${mediaItemCount}`);
      console.log(`  Faces detected: ${featureCount}`);
      console.log(`  Hash matches:   ${matchCount}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`fatal: ${message}`);
      process.exit(1);
    } finally {
      await models?.dispose();
      try { client?.db.close(); } catch { /* already closed */ }
    }
  });
