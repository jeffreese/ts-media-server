import { Command } from 'commander';

export const testCommand = new Command('test')
  .description('Test external dependencies and services');

testCommand
  .command('ffmpeg')
  .description('Verify FFmpeg installation and print version')
  .action(() => {
    // TODO: validate FFmpeg installation, print version
    console.log('test ffmpeg command not yet implemented');
  });

testCommand
  .command('metadata')
  .description('Extract and display metadata from a media file')
  .requiredOption('--file <path>', 'file to extract metadata from')
  .action((_options) => {
    // TODO: extract and pretty-print metadata from file
    console.log('test metadata command not yet implemented');
  });

testCommand
  .command('faces')
  .description('Detect faces in an image and display results')
  .requiredOption('--file <path>', 'image file to detect faces in')
  .action((_options) => {
    // TODO: detect faces, print count and bounding boxes, save annotated image
    console.log('test faces command not yet implemented');
  });
