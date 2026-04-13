import sharp from 'sharp';

/**
 * Set sharp's internal libvips thread pool size. Call once at startup
 * before any image operations.
 */
export function configureSharp(threads: number): void {
  sharp.concurrency(threads);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResizeOptions {
  width?: number;
  height?: number;
}

export interface JpegOptions {
  quality?: number;
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

/**
 * Load an image from a file path, auto-rotating based on EXIF orientation.
 * Supports JPEG, PNG, WebP, TIFF, and HEIC.
 */
export function loadImage(filePath: string): sharp.Sharp {
  return sharp(filePath).rotate();
}

/**
 * Load an image from a Buffer, auto-rotating based on EXIF orientation.
 */
export function loadImageFromBuffer(buffer: Buffer): sharp.Sharp {
  return sharp(buffer).rotate();
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * Get the dimensions of an image after auto-rotation is applied.
 * Uses sharp's `autoOrient` metadata when available so that EXIF-rotated
 * images report their logical (display) dimensions, not the raw pixel layout.
 */
export async function getDimensions(image: sharp.Sharp): Promise<ImageDimensions> {
  const metadata = await image.metadata();

  const oriented = metadata.autoOrient;
  const width = oriented?.width ?? metadata.width;
  const height = oriented?.height ?? metadata.height;

  if (width === undefined || height === undefined) {
    throw new Error('Could not determine image dimensions');
  }

  return { width, height };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

/**
 * Resize an image while preserving aspect ratio. The image fits inside the
 * given bounding box without upscaling.
 *
 * Returns a new sharp instance — the original is not mutated.
 */
export function resize(image: sharp.Sharp, options: ResizeOptions): sharp.Sharp {
  return image.clone().resize({
    width: options.width,
    height: options.height,
    fit: 'inside',
    withoutEnlargement: true,
  });
}

// ---------------------------------------------------------------------------
// Sharpen
// ---------------------------------------------------------------------------

/**
 * Apply sharpening suitable for small thumbnails.
 *
 * Returns a new sharp instance — the original is not mutated.
 */
export function sharpen(image: sharp.Sharp): sharp.Sharp {
  return image.clone().sharpen();
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

/**
 * Extract a rectangular region from an image (e.g. for face thumbnail crops).
 *
 * Returns a new sharp instance — the original is not mutated.
 */
export function crop(image: sharp.Sharp, region: CropRegion): sharp.Sharp {
  return image.clone().extract({
    left: Math.round(region.left),
    top: Math.round(region.top),
    width: Math.round(region.width),
    height: Math.round(region.height),
  });
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert an image to a JPEG buffer with configurable quality.
 * Defaults to 90% quality.
 */
export async function toJpegBuffer(
  image: sharp.Sharp,
  options: JpegOptions = {},
): Promise<Buffer> {
  const { quality = 90 } = options;
  return image.clone().jpeg({ quality }).toBuffer();
}

/**
 * Convert an image to a raw RGB pixel buffer suitable for ONNX model
 * preprocessing. Returns the buffer along with the actual output dimensions.
 */
export async function toRawPixelBuffer(
  image: sharp.Sharp,
): Promise<{ buffer: Buffer; width: number; height: number; channels: number }> {
  const { data, info } = await image
    .clone()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}
