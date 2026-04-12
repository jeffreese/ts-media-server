import { Command } from 'commander';
import { serveCommand } from './cli/serve.js';
import { addCommand } from './cli/add.js';
import { deleteCommand } from './cli/delete.js';
import { testCommand } from './cli/test.js';

const program = new Command()
  .name('media-server')
  .description('TypeScript media server — index, browse, and serve photo and video libraries')
  .version('0.1.0');

program.addCommand(serveCommand);
program.addCommand(addCommand);
program.addCommand(deleteCommand);
program.addCommand(testCommand);

program.parse();
