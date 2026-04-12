import { Command } from 'commander';

export const deleteCommand = new Command('delete')
  .description('Delete generated data');

deleteCommand
  .command('thumbnails')
  .description('Delete generated thumbnails for a directory')
  .requiredOption('--path <path>', 'directory to delete thumbnails from')
  .action((_options) => {
    // TODO: call thumbnail.deleteThumbnails(directory)
    console.log('delete thumbnails command not yet implemented');
  });

deleteCommand
  .command('orphans')
  .description('Delete orphaned database records with no matching files on disk')
  .action(() => {
    // TODO: call fileIndex.deleteOrphans()
    console.log('delete orphans command not yet implemented');
  });
