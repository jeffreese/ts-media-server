import { Command } from 'commander';

export const serveCommand = new Command('serve')
  .description('Start the media server')
  .option('-p, --port <number>', 'port to listen on')
  .option('-c, --config <path>', 'path to config file')
  .option('-w, --web <path>', 'path to web directory')
  .action((_options) => {
    // TODO: initialize config, database, migrations, and start Fastify server
    console.log('serve command not yet implemented');
  });
