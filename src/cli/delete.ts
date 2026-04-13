import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { loadConfig } from '../config/config.js';
import { createDatabaseClient, type DatabaseClient } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import * as schema from '../db/schema.js';
import { FFmpeg } from '../utils/ffmpeg.js';
import { createLoggerFromConfig } from '../utils/logger.js';
import { NotificationService } from '../services/notification.js';
import { FileIndex } from '../services/file-index.js';
import { deleteThumbnails } from '../services/thumbnail.js';

interface DeleteThumbnailsOptions {
  path: string;
}

interface DeleteOrphansOptions {
  config?: string;
}

/** Commander command group: remove generated files or orphaned DB rows. */
export const deleteCommand = new Command('delete')
  .description('Delete generated data');

deleteCommand
  .command('thumbnails')
  .description('Delete generated thumbnails for a directory')
  .requiredOption('--path <path>', 'directory to delete thumbnails from')
  .action(async (options: DeleteThumbnailsOptions) => {
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

      const deleted = await deleteThumbnails(directory);

      console.log('Thumbnail deletion complete:');
      console.log(`  Directories removed: ${deleted}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`fatal: ${message}`);
      process.exit(1);
    }
  });

deleteCommand
  .command('orphans')
  .description('Delete orphaned database records with no matching files on disk')
  .option('-c, --config <path>', 'path to config file')
  .action(async (options: DeleteOrphansOptions) => {
    let client: DatabaseClient | undefined;

    try {
      const config = await loadConfig({ configPath: options.config });
      const logger = createLoggerFromConfig(config, 'delete-orphans');

      client = createDatabaseClient({ path: config.database.path });
      runMigrations(client);
      seedDatabase(client);

      const db = drizzle(client.db, { schema });

      const ffmpeg = new FFmpeg();

      const notificationService = new NotificationService();

      const fileIndex = new FileIndex({
        db,
        ffmpeg,
        notifications: notificationService,
        logger,
      });

      const result = await fileIndex.deleteOrphans();

      console.log('Orphan cleanup complete:');
      console.log(`  Files removed:       ${result.files}`);
      console.log(`  Media items removed: ${result.mediaItems}`);
      console.log(`  Paths removed:       ${result.paths}`);
      console.log(`  Folders removed:     ${result.folders}`);
      console.log(`  Thumbnails removed:  ${result.thumbnails}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`fatal: ${message}`);
      process.exit(1);
    } finally {
      try { client?.db.close(); } catch { /* already closed */ }
    }
  });
