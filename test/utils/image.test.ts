import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import {
  loadImage,
  loadImageFromBuffer,
  getDimensions,
  resize,
  sharpen,
  crop,
  toJpegBuffer,
  toRawPixelBuffer,
} from '../../src/utils/image.js';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers — generate test images in-memory via sharp
// ---------------------------------------------------------------------------

function createTestImage(width: number, height: number): sharp.Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 64, b: 32 },
    },
  });
}

async function createTestJpegBuffer(width: number, height: number): Promise<Buffer> {
  return createTestImage(width, height).jpeg().toBuffer();
}

/**
 * Create a JPEG buffer with EXIF orientation tag 6 (rotated 90° CW).
 * The stored pixel dimensions are height×width, but after auto-rotation
 * the logical dimensions should be width×height.
 */
async function createRotatedJpegBuffer(
  logicalWidth: number,
  logicalHeight: number,
): Promise<Buffer> {
  const jpegBuf = await createTestImage(logicalHeight, logicalWidth)
    .jpeg()
    .toBuffer();

  return sharp(jpegBuf)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

/**
 * Materialize a sharp pipeline and return the output dimensions.
 * Unlike getDimensions (which reads input metadata), this executes
 * the full pipeline to get the actual output size.
 */
async function getOutputDimensions(
  image: sharp.Sharp,
): Promise<{ width: number; height: number }> {
  const { info } = await image.clone().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('image utilities', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'image-test-'));

    return async () => {
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  // -------------------------------------------------------------------------
  // loadImage / loadImageFromBuffer
  // -------------------------------------------------------------------------

  describe('loadImage', () => {
    it('loads an image from a file path', async () => {
      const filePath = join(tempDir, 'test.jpg');
      const buf = await createTestJpegBuffer(200, 100);
      await writeFile(filePath, buf);

      const image = loadImage(filePath);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(200);
      expect(dims.height).toBe(100);
    });

    it('throws for a non-existent file', async () => {
      const image = loadImage(join(tempDir, 'missing.jpg'));
      await expect(getDimensions(image)).rejects.toThrow();
    });
  });

  describe('loadImageFromBuffer', () => {
    it('loads an image from a buffer', async () => {
      const buf = await createTestJpegBuffer(300, 200);
      const image = loadImageFromBuffer(buf);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(300);
      expect(dims.height).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // getDimensions
  // -------------------------------------------------------------------------

  describe('getDimensions', () => {
    it('returns width and height', async () => {
      const image = createTestImage(640, 480);
      const dims = await getDimensions(image);

      expect(dims).toEqual({ width: 640, height: 480 });
    });

    it('returns oriented dimensions for EXIF-rotated images', async () => {
      const buf = await createRotatedJpegBuffer(400, 300);
      const image = loadImageFromBuffer(buf);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(400);
      expect(dims.height).toBe(300);
    });
  });

  // -------------------------------------------------------------------------
  // auto-rotation
  // -------------------------------------------------------------------------

  describe('auto-rotation', () => {
    it('rotates based on EXIF orientation', async () => {
      const buf = await createRotatedJpegBuffer(400, 300);
      const image = loadImageFromBuffer(buf);
      const dims = await getOutputDimensions(image);

      expect(dims.width).toBe(400);
      expect(dims.height).toBe(300);
    });
  });

  // -------------------------------------------------------------------------
  // resize
  // -------------------------------------------------------------------------

  describe('resize', () => {
    it('resizes preserving aspect ratio', async () => {
      const image = createTestImage(1920, 1080);
      const resized = resize(image, { width: 640, height: 480 });
      const dims = await getOutputDimensions(resized);

      expect(dims.width).toBeLessThanOrEqual(640);
      expect(dims.height).toBeLessThanOrEqual(480);
      const ratio = dims.width / dims.height;
      expect(ratio).toBeCloseTo(1920 / 1080, 1);
    });

    it('does not upscale', async () => {
      const image = createTestImage(200, 100);
      const resized = resize(image, { width: 1920, height: 1080 });
      const dims = await getOutputDimensions(resized);

      expect(dims.width).toBe(200);
      expect(dims.height).toBe(100);
    });

    it('resizes by width only', async () => {
      const image = createTestImage(1000, 500);
      const resized = resize(image, { width: 300 });
      const dims = await getOutputDimensions(resized);

      expect(dims.width).toBe(300);
      expect(dims.height).toBe(150);
    });

    it('resizes by height only', async () => {
      const image = createTestImage(1000, 500);
      const resized = resize(image, { height: 100 });
      const dims = await getOutputDimensions(resized);

      expect(dims.width).toBe(200);
      expect(dims.height).toBe(100);
    });

    it('does not mutate the original image', async () => {
      const image = createTestImage(800, 600);
      resize(image, { width: 100 });
      const dims = await getDimensions(image);

      expect(dims.width).toBe(800);
      expect(dims.height).toBe(600);
    });
  });

  // -------------------------------------------------------------------------
  // sharpen
  // -------------------------------------------------------------------------

  describe('sharpen', () => {
    it('returns a sharpened image with the same dimensions', async () => {
      const image = createTestImage(150, 100);
      const sharpened = sharpen(image);
      const dims = await getOutputDimensions(sharpened);

      expect(dims.width).toBe(150);
      expect(dims.height).toBe(100);
    });

    it('does not mutate the original image', async () => {
      const image = createTestImage(150, 100);
      sharpen(image);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(150);
      expect(dims.height).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // crop
  // -------------------------------------------------------------------------

  describe('crop', () => {
    it('extracts a region from the image', async () => {
      const image = createTestImage(500, 400);
      const cropped = crop(image, { left: 50, top: 50, width: 200, height: 150 });
      const dims = await getOutputDimensions(cropped);

      expect(dims.width).toBe(200);
      expect(dims.height).toBe(150);
    });

    it('rounds fractional coordinates', async () => {
      const image = createTestImage(500, 400);
      const cropped = crop(image, { left: 10.7, top: 20.3, width: 100.5, height: 80.9 });
      const dims = await getOutputDimensions(cropped);

      expect(dims.width).toBe(101);
      expect(dims.height).toBe(81);
    });

    it('throws for out-of-bounds crop', async () => {
      const image = createTestImage(100, 100);
      const cropped = crop(image, { left: 50, top: 50, width: 200, height: 200 });

      await expect(toJpegBuffer(cropped)).rejects.toThrow();
    });

    it('does not mutate the original image', async () => {
      const image = createTestImage(500, 400);
      crop(image, { left: 0, top: 0, width: 100, height: 100 });
      const dims = await getDimensions(image);

      expect(dims.width).toBe(500);
      expect(dims.height).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // toJpegBuffer
  // -------------------------------------------------------------------------

  describe('toJpegBuffer', () => {
    it('produces a valid JPEG buffer', async () => {
      const image = createTestImage(200, 100);
      const buf = await toJpegBuffer(image);

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
    });

    it('uses default quality of 90', async () => {
      const image = createTestImage(200, 100);
      const defaultBuf = await toJpegBuffer(image);
      const explicitBuf = await toJpegBuffer(image, { quality: 90 });

      expect(defaultBuf.length).toBe(explicitBuf.length);
    });

    it('respects custom quality', async () => {
      const image = createTestImage(200, 100);
      const highQ = await toJpegBuffer(image, { quality: 100 });
      const lowQ = await toJpegBuffer(image, { quality: 10 });

      expect(highQ.length).toBeGreaterThan(lowQ.length);
    });

    it('does not mutate the original image', async () => {
      const image = createTestImage(200, 100);
      await toJpegBuffer(image);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(200);
      expect(dims.height).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // toRawPixelBuffer
  // -------------------------------------------------------------------------

  describe('toRawPixelBuffer', () => {
    it('returns raw RGB buffer with correct dimensions', async () => {
      const image = createTestImage(50, 30);
      const result = await toRawPixelBuffer(image);

      expect(result.width).toBe(50);
      expect(result.height).toBe(30);
      expect(result.channels).toBe(3);
      expect(result.buffer.length).toBe(50 * 30 * 3);
    });

    it('strips alpha channel from RGBA images', async () => {
      const image = sharp({
        create: {
          width: 10,
          height: 10,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      });

      const result = await toRawPixelBuffer(image);

      expect(result.channels).toBe(3);
      expect(result.buffer.length).toBe(10 * 10 * 3);
    });

    it('does not mutate the original image', async () => {
      const image = createTestImage(50, 30);
      await toRawPixelBuffer(image);
      const dims = await getDimensions(image);

      expect(dims.width).toBe(50);
      expect(dims.height).toBe(30);
    });
  });

  // -------------------------------------------------------------------------
  // Composable pipeline
  // -------------------------------------------------------------------------

  describe('composable pipeline', () => {
    it('supports resize → sharpen → toJpegBuffer', async () => {
      const image = createTestImage(1920, 1080);
      const resized = resize(image, { width: 150, height: 100 });
      const sharpened = sharpen(resized);
      const buf = await toJpegBuffer(sharpened, { quality: 100 });

      expect(buf).toBeInstanceOf(Buffer);

      const meta = await sharp(buf).metadata();
      expect(meta.width).toBeLessThanOrEqual(150);
      expect(meta.height).toBeLessThanOrEqual(100);
      expect(meta.format).toBe('jpeg');
    });

    it('supports crop → resize → toJpegBuffer', async () => {
      const image = createTestImage(800, 600);
      const cropped = crop(image, { left: 100, top: 100, width: 300, height: 300 });
      const resized = resize(cropped, { width: 100 });
      const buf = await toJpegBuffer(resized);

      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(100);
      expect(meta.format).toBe('jpeg');
    });
  });
});
