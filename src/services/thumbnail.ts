import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, parse as parsePath } from 'node:path';
import type sharp from 'sharp';
import { getDimensions, resize, sharpen, toJpegBuffer } from '../utils/image.js';
import { atomicWrite } from '../utils/file.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThumbnailTier {
  width: number;
  height: number;
}

export interface ThumbnailResult {
  width: number;
  height: number;
  path: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THUMBNAIL_DIR_NAME = '.thumbnails';

const SMALL_THRESHOLD = 300;

/**
 * Resolution tiers ordered largest to smallest. Each tier defines the
 * bounding box the image is resized into (preserving aspect ratio).
 */
export const THUMBNAIL_TIERS: readonly ThumbnailTier[] = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
  { width: 300, height: 300 },
  { width: 150, height: 100 },
] as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Return the `.thumbnails` directory path for a given media file.
 */
export function getThumbnailDirectory(filePath: string): string {
  const parsed = parsePath(filePath);
  return join(parsed.dir, THUMBNAIL_DIR_NAME);
}

/**
 * Return the path for a specific thumbnail size of a given media file.
 */
export function getThumbnailPath(filePath: string, width: number): string {
  const parsed = parsePath(filePath);
  return join(parsed.dir, THUMBNAIL_DIR_NAME, `${parsed.name}_${width}.jpg`);
}

// ---------------------------------------------------------------------------
// Tier selection
// ---------------------------------------------------------------------------

/**
 * Select which tiers to generate based on source image dimensions.
 * Tiers whose bounding box is larger than the source in both dimensions
 * are skipped — there's no point upscaling.
 */
export function selectTiers(
  sourceWidth: number,
  sourceHeight: number,
): ThumbnailTier[] {
  return THUMBNAIL_TIERS.filter(
    (tier) => tier.width < sourceWidth || tier.height < sourceHeight,
  );
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate all applicable thumbnail tiers for an image.
 *
 * @param image - A sharp instance of the source image (already auto-rotated).
 * @param primaryFilePath - The path to the primary file, used to derive
 *   the thumbnail directory and file names.
 * @returns The list of thumbnails that were written to disk.
 */
export async function createThumbnails(
  image: sharp.Sharp,
  primaryFilePath: string,
): Promise<ThumbnailResult[]> {
  const dimensions = await getDimensions(image);
  const tiers = selectTiers(dimensions.width, dimensions.height);

  if (tiers.length === 0) return [];

  const thumbnailDir = getThumbnailDirectory(primaryFilePath);
  await mkdir(thumbnailDir, { recursive: true });

  const results: ThumbnailResult[] = [];

  for (const tier of tiers) {
    const resized = resize(image, { width: tier.width, height: tier.height });

    const isSmall = tier.width <= SMALL_THRESHOLD;
    const pipeline = isSmall ? sharpen(resized) : resized;
    const quality = isSmall ? 100 : 90;

    const buffer = await toJpegBuffer(pipeline, { quality });
    const outPath = getThumbnailPath(primaryFilePath, tier.width);
    await atomicWrite(outPath, buffer);

    results.push({ width: tier.width, height: tier.height, path: outPath });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Thumbnail deletion
// ---------------------------------------------------------------------------

/**
 * Recursively delete all `.thumbnails` subdirectories under a given directory.
 */
export async function deleteThumbnails(directory: string): Promise<number> {
  let deleted = 0;
  await deleteThumbnailsRecursive(directory, (count) => {
    deleted += count;
  });
  return deleted;
}

async function deleteThumbnailsRecursive(
  directory: string,
  onDeleted: (count: number) => void,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = join(directory, entry.name);

    if (entry.name === THUMBNAIL_DIR_NAME) {
      await rm(fullPath, { recursive: true, force: true });
      onDeleted(1);
    } else {
      await deleteThumbnailsRecursive(fullPath, onDeleted);
    }
  }
}

// ---------------------------------------------------------------------------
// Thumbnail listing
// ---------------------------------------------------------------------------

/**
 * List available thumbnail widths for a given media file by scanning the
 * `.thumbnails` directory.
 */
export async function listThumbnails(filePath: string): Promise<number[]> {
  const parsed = parsePath(filePath);
  const thumbnailDir = getThumbnailDirectory(filePath);
  const prefix = `${parsed.name}_`;

  let entries;
  try {
    entries = await readdir(thumbnailDir);
  } catch {
    return [];
  }

  const widths: number[] = [];

  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.jpg')) continue;

    const widthStr = name.slice(prefix.length, -4);
    const width = Number(widthStr);
    if (Number.isFinite(width) && width > 0) {
      widths.push(width);
    }
  }

  return widths.sort((a, b) => a - b);
}
