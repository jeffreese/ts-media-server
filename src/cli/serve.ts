import { Command } from 'commander';
import { loadConfig } from '../config/config.js';
import { createDatabaseClient } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { createApp } from '../server/app.js';

interface ServeOptions {
  port?: string;
  config?: string;
  web?: string;
}

export const serveCommand = new Command('serve')
  .description('Start the media server')
  .option('-p, --port <number>', 'port to listen on')
  .option('-c, --config <path>', 'path to config file')
  .option('-w, --web <path>', 'path to web directory')
  .action(async (options: ServeOptions) => {
    const overrides: Record<string, unknown> = {};
    if (options.port) overrides.port = Number(options.port);
    if (options.web) overrides.webDir = options.web;

    const config = await loadConfig({ configPath: options.config, overrides });

    const client = createDatabaseClient({ path: config.database.path });
    runMigrations(client);
    seedDatabase(client);

    const { server, close } = await createApp({
      config,
      loggerOptions: { level: config.logLevel, name: 'media-server' },
    });

    const shutdown = async () => {
      server.log.info('shutting down');
      await close();
      client.db.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await server.listen({ port: config.port, host: '0.0.0.0' });
    server.log.info({ port: config.port }, `media server listening on http://localhost:${config.port}`);
  });
