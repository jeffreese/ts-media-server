import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname, join, parse as parsePath } from 'node:path';
import { Command } from 'commander';

import { FFmpeg } from '../utils/ffmpeg.js';
import { loadImage, getDimensions, toJpegBuffer } from '../utils/image.js';
import { extractMetadata, toWktPoint } from '../services/metadata.js';
import { detectFaces, type FaceDetection } from '../services/face-detection.js';
import { loadModel } from '../services/onnx-models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFileExists(filePath: string): string {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`error: file does not exist: ${resolved}`);
    process.exit(1);
  }
  if (!statSync(resolved).isFile()) {
    console.error(`error: path is not a file: ${resolved}`);
    process.exit(1);
  }
  return resolved;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// SVG annotation
// ---------------------------------------------------------------------------

function buildAnnotationSvg(
  width: number,
  height: number,
  detections: FaceDetection[],
): Buffer {
  const rects = detections
    .map(
      (d, i) =>
        `<rect x="${Math.round(d.x)}" y="${Math.round(d.y)}" ` +
        `width="${Math.round(d.width)}" height="${Math.round(d.height)}" ` +
        `fill="none" stroke="lime" stroke-width="3"/>` +
        `<text x="${Math.round(d.x)}" y="${Math.round(d.y) - 6}" ` +
        `fill="lime" font-size="18" font-family="sans-serif">#${i + 1} (${(d.score * 100).toFixed(1)}%)</text>`,
    )
    .join('\n  ');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n  ${rects}\n</svg>`;
  return Buffer.from(svg);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export const testCommand = new Command('test')
  .description('Test external dependencies and services');

testCommand
  .command('ffmpeg')
  .description('Verify FFmpeg installation and print version')
  .option('--ffmpeg-path <path>', 'path to ffmpeg binary')
  .option('--ffprobe-path <path>', 'path to ffprobe binary')
  .action(async (options: { ffmpegPath?: string; ffprobePath?: string }) => {
    try {
      const ffmpeg = new FFmpeg({
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
      });

      await ffmpeg.validate();
      const version = await ffmpeg.getVersion();

      console.log('FFmpeg is installed and working.');
      console.log(`  Version:      ${version}`);
      console.log(`  ffmpeg path:  ${ffmpeg.ffmpegPath}`);
      console.log(`  ffprobe path: ${ffmpeg.ffprobePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: ${message}`);
      process.exit(1);
    }
  });

testCommand
  .command('metadata')
  .description('Extract and display metadata from a media file')
  .requiredOption('--file <path>', 'file to extract metadata from')
  .option('--ffmpeg-path <path>', 'path to ffmpeg binary')
  .option('--ffprobe-path <path>', 'path to ffprobe binary')
  .action(async (options: { file: string; ffmpegPath?: string; ffprobePath?: string }) => {
    try {
      const filePath = assertFileExists(options.file);

      const ffmpeg = new FFmpeg({
        ffmpegPath: options.ffmpegPath,
        ffprobePath: options.ffprobePath,
      });

      const meta = await extractMetadata(filePath, ffmpeg);

      console.log(`Metadata for: ${filePath}\n`);

      if (meta.date) {
        console.log('Date:');
        console.log(`  Date:   ${meta.date.date}`);
        console.log(`  Offset: ${formatValue(meta.date.offset)}`);
      }

      console.log('Dimensions:');
      console.log(`  Width:  ${formatValue(meta.width)}`);
      console.log(`  Height: ${formatValue(meta.height)}`);

      if (meta.duration !== undefined || meta.frameRate !== undefined) {
        console.log('Video:');
        console.log(`  Duration:   ${formatValue(meta.duration)}s`);
        console.log(`  Frame rate: ${formatValue(meta.frameRate)} fps`);
      }

      console.log('Camera:');
      console.log(`  Make:       ${formatValue(meta.camera.make)}`);
      console.log(`  Model:      ${formatValue(meta.camera.model)}`);
      console.log(`  Lens make:  ${formatValue(meta.camera.lensMake)}`);
      console.log(`  Lens model: ${formatValue(meta.camera.lensModel)}`);

      console.log('Exposure:');
      console.log(`  Focal length:  ${formatValue(meta.exposure.focalLength)}mm`);
      console.log(`  Aperture:      ${formatValue(meta.exposure.aperture)}`);
      console.log(`  f-stop:        f/${formatValue(meta.exposure.fStop)}`);
      console.log(`  Shutter speed: ${formatValue(meta.exposure.shutterSpeed)}`);
      console.log(`  ISO:           ${formatValue(meta.exposure.iso)}`);

      if (meta.gps) {
        console.log('GPS:');
        console.log(`  Latitude:  ${meta.gps.latitude}`);
        console.log(`  Longitude: ${meta.gps.longitude}`);
        console.log(`  Datum:     ${formatValue(meta.gps.datum)}`);
        console.log(`  Azimuth:   ${formatValue(meta.gps.azimuth)}`);
        console.log(`  WKT:       ${toWktPoint(meta.gps)}`);
      }

      if (meta.iptc.headline || meta.iptc.caption || meta.iptc.keywords.length > 0 || meta.iptc.copyright) {
        console.log('IPTC:');
        console.log(`  Headline:  ${formatValue(meta.iptc.headline)}`);
        console.log(`  Caption:   ${formatValue(meta.iptc.caption)}`);
        console.log(`  Keywords:  ${meta.iptc.keywords.length > 0 ? meta.iptc.keywords.join(', ') : '—'}`);
        console.log(`  Copyright: ${formatValue(meta.iptc.copyright)}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: ${message}`);
      process.exit(1);
    }
  });

testCommand
  .command('faces')
  .description('Detect faces in an image and display results')
  .requiredOption('--file <path>', 'image file to detect faces in')
  .option('--model <path>', 'path to YuNet face detection ONNX model')
  .option('--threshold <number>', 'minimum confidence score (0–1)', '0.6')
  .action(async (options: { file: string; model?: string; threshold: string }) => {
    let session: import('onnxruntime-node').InferenceSession | undefined;

    try {
      const filePath = assertFileExists(options.file);

      if (!options.model) {
        console.error('error: --model is required (path to YuNet .onnx file)');
        process.exit(1);
      }

      const modelPath = assertFileExists(options.model);
      const scoreThreshold = Number(options.threshold);

      if (!Number.isFinite(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 1) {
        console.error('error: --threshold must be a number between 0 and 1');
        process.exit(1);
      }

      console.log('Loading face detection model…');
      session = await loadModel(modelPath, 'Face detection');

      console.log(`Detecting faces in: ${filePath}`);
      const image = loadImage(filePath);
      const { width, height } = await getDimensions(image);

      const results = await detectFaces(session, image, { scoreThreshold });

      console.log(`\nDetected ${results.length} face(s) in ${width}×${height} image\n`);

      for (const [i, { detection }] of results.entries()) {
        const d = detection;
        console.log(`Face #${i + 1}:`);
        console.log(`  Score:      ${(d.score * 100).toFixed(1)}%`);
        console.log(`  Bounds:     x=${Math.round(d.x)}, y=${Math.round(d.y)}, ${Math.round(d.width)}×${Math.round(d.height)}`);
        console.log(`  Landmarks:`);
        console.log(`    Right eye:    (${Math.round(d.landmarks.rightEye.x)}, ${Math.round(d.landmarks.rightEye.y)})`);
        console.log(`    Left eye:     (${Math.round(d.landmarks.leftEye.x)}, ${Math.round(d.landmarks.leftEye.y)})`);
        console.log(`    Nose tip:     (${Math.round(d.landmarks.noseTip.x)}, ${Math.round(d.landmarks.noseTip.y)})`);
        console.log(`    Right mouth:  (${Math.round(d.landmarks.rightMouthCorner.x)}, ${Math.round(d.landmarks.rightMouthCorner.y)})`);
        console.log(`    Left mouth:   (${Math.round(d.landmarks.leftMouthCorner.x)}, ${Math.round(d.landmarks.leftMouthCorner.y)})`);
      }

      if (results.length > 0) {
        const detections = results.map((r) => r.detection);
        const svgOverlay = buildAnnotationSvg(width, height, detections);

        const annotated = loadImage(filePath)
          .composite([{ input: svgOverlay, blend: 'over' }]);

        const annotatedBuffer = await toJpegBuffer(annotated, { quality: 90 });

        const parsed = parsePath(filePath);
        const outputPath = join(dirname(filePath), `${parsed.name}_faces${parsed.ext}`);
        await writeFile(outputPath, annotatedBuffer);

        console.log(`\nAnnotated image saved: ${outputPath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`error: ${message}`);
      process.exit(1);
    } finally {
      await session?.release();
    }
  });
