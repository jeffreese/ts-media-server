import { Command } from 'commander';

export const addCommand = new Command('add')
  .description('Add media to the library');

addCommand
  .command('directory')
  .description('Index a directory of media files')
  .requiredOption('--path <path>', 'directory to index')
  .option('--concurrency <number>', 'number of files to process in parallel')
  .action((_options) => {
    // TODO: initialize config, database, services, run fileIndex.addDirectory()
    console.log('add directory command not yet implemented');
  });
