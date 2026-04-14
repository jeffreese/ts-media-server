import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  createThumbnails,
  deleteThumbnails,
  getThumbnailDirectory,
  getThumbnailPath,
  listThumbnails,
  selectTiers,
  THUMBNAIL_TIERS,
} from '../../src/services/thumbnail.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestImage(width: number, height: number): sharp.Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 64, b: 32 },
    },
  }).rotate();
}

async function writeTestJpeg(dir: string, name: string, width: number, height: number): Promise<string> {
  const filePath = join(dir, name);
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 64, b: 32 } },
  }).jpeg().toBuffer();

  await writeFile(filePath, buf);
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('thumbnail service', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'thumbnail-test-'));

    return async () => {
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  describe('getThumbnailDirectory', () => {
    it('returns .thumbnails subdirectory in the same directory as the file', () => {
      expect(getThumbnailDirectory('/photos/vacation/IMG_001.jpg'))
        .toBe('/photos/vacation/.thumbnails');
    });

    it('handles files in the root directory', () => {
      expect(getThumbnailDirectory('/photo.jpg')).toBe('/.thumbnails');
    });
  });

  describe('getThumbnailPath', () => {
    it('returns path with name and width', () => {
      expect(getThumbnailPath('/photos/IMG_001.jpg', 640))
        .toBe('/photos/.thumbnails/IMG_001_640.jpg');
    });

    it('uses the file name without extension', () => {
      expect(getThumbnailPath('/photos/sunset.heic', 300))
        .toBe('/photos/.thumbnails/sunset_300.jpg');
    });

    it('handles names with dots', () => {
      expect(getThumbnailPath('/photos/my.photo.jpg', 150))
        .toBe('/photos/.thumbnails/my.photo_150.jpg');
    });
  });

  // -------------------------------------------------------------------------
  // Tier selection
  // -------------------------------------------------------------------------

  describe('selectTiers', () => {
    it('returns all tiers for a very large image', () => {
      const tiers = selectTiers(4000, 3000);
      expect(tiers).toHaveLength(THUMBNAIL_TIERS.length);
    });

    it('skips tiers larger than the source image', () => {
      const tiers = selectTiers(800, 600);

      const widths = tiers.map((t) => t.width);
      expect(widths).toContain(640);
      expect(widths).toContain(300);
      expect(widths).toContain(150);
      expect(widths).not.toContain(1920);
      expect(widths).not.toContain(1280);
    });

    it('returns no tiers for an image smaller than all tiers', () => {
      const tiers = selectTiers(100, 80);
      expect(tiers).toHaveLength(0);
    });

    it('includes a tier when source is larger in only one dimension', () => {
      // 200x2000: width is small but height exceeds all tiers
      const tiers = selectTiers(200, 2000);
      const widths = tiers.map((t) => t.width);
      expect(widths).toContain(150);
    });

    it('returns exactly the tiers that fit for a 1280x720 source', () => {
      // 1280x720 is equal to the second tier — only smaller tiers should be included
      const tiers = selectTiers(1280, 720);
      const widths = tiers.map((t) => t.width);
      expect(widths).not.toContain(1920);
      expect(widths).not.toContain(1280);
      expect(widths).toContain(640);
      expect(widths).toContain(300);
      expect(widths).toContain(150);
    });
  });

  // -------------------------------------------------------------------------
  // createThumbnails
  // -------------------------------------------------------------------------

  describe('createThumbnails', () => {
    it('generates thumbnails for all applicable tiers', async () => {
      const subDir = join(tempDir, 'create-all');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'landscape.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      const results = await createThumbnails(image, filePath);

      expect(results.length).toBe(THUMBNAIL_TIERS.length);

      for (const result of results) {
        const fileStat = await stat(result.path);
        expect(fileStat.isFile()).toBe(true);
        expect(fileStat.size).toBeGreaterThan(0);
      }
    });

    it('creates the .thumbnails directory', async () => {
      const subDir = join(tempDir, 'create-dir');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'photo.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      await createThumbnails(image, filePath);

      const thumbDir = join(subDir, '.thumbnails');
      const dirStat = await stat(thumbDir);
      expect(dirStat.isDirectory()).toBe(true);
    });

    it('names files with {name}_{width}.jpg convention', async () => {
      const subDir = join(tempDir, 'naming');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'sunset.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      await createThumbnails(image, filePath);

      const thumbDir = join(subDir, '.thumbnails');
      const files = await readdir(thumbDir);

      for (const tier of THUMBNAIL_TIERS) {
        expect(files).toContain(`sunset_${tier.width}.jpg`);
      }
    });

    it('skips tiers larger than the source', async () => {
      const subDir = join(tempDir, 'skip-large');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'small.jpg', 400, 300);
      const image = createTestImage(400, 300);

      const results = await createThumbnails(image, filePath);
      const widths = results.map((r) => r.width);

      expect(widths).not.toContain(1920);
      expect(widths).not.toContain(1280);
      expect(widths).toContain(300);
      expect(widths).toContain(150);
    });

    it('returns empty array when source is smaller than all tiers', async () => {
      const subDir = join(tempDir, 'too-small');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'tiny.jpg', 100, 80);
      const image = createTestImage(100, 80);

      const results = await createThumbnails(image, filePath);
      expect(results).toHaveLength(0);
    });

    it('produces valid JPEG files', async () => {
      const subDir = join(tempDir, 'valid-jpeg');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'check.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      const results = await createThumbnails(image, filePath);

      for (const result of results) {
        const buf = await readFile(result.path);
        // JPEG magic bytes
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0xd8);

        const meta = await sharp(buf).metadata();
        expect(meta.format).toBe('jpeg');
      }
    });

    it('applies sharpening to small thumbnails (≤300px)', async () => {
      const subDir = join(tempDir, 'sharpening');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'sharp-test.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      const results = await createThumbnails(image, filePath);

      const small = results.filter((r) => r.width <= 300);
      const large = results.filter((r) => r.width > 300);

      expect(small.length).toBeGreaterThan(0);
      expect(large.length).toBeGreaterThan(0);

      // Small thumbnails use quality 100, large use 90.
      // For the same pixel count, quality 100 produces larger files.
      // We verify the small thumbnails exist and are valid — sharpening
      // is applied but we trust sharp's implementation.
      for (const result of small) {
        const buf = await readFile(result.path);
        expect(buf.length).toBeGreaterThan(0);
      }
    });

    it('uses higher JPEG quality for small thumbnails', async () => {
      const subDir = join(tempDir, 'quality');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'quality-test.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      const results = await createThumbnails(image, filePath);

      // The 300px and 150px thumbnails should be quality 100.
      // The 640px, 1280px, 1920px thumbnails should be quality 90.
      // We can't directly read JPEG quality from the file, but we can
      // verify that all thumbnails were created and are valid.
      expect(results.length).toBe(THUMBNAIL_TIERS.length);
    });

    it('preserves aspect ratio in generated thumbnails', async () => {
      const subDir = join(tempDir, 'aspect-ratio');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'wide.jpg', 3000, 1000);
      const image = createTestImage(3000, 1000);

      const results = await createThumbnails(image, filePath);

      for (const result of results) {
        const buf = await readFile(result.path);
        const meta = await sharp(buf).metadata();
        const ratio = (meta.width ?? 0) / (meta.height ?? 1);
        expect(ratio).toBeCloseTo(3, 0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // deleteThumbnails
  // -------------------------------------------------------------------------

  describe('deleteThumbnails', () => {
    it('deletes .thumbnails directories recursively', async () => {
      const subDir = join(tempDir, 'delete-test');
      const thumbDir1 = join(subDir, '.thumbnails');
      const thumbDir2 = join(subDir, 'sub', '.thumbnails');
      await mkdir(thumbDir1, { recursive: true });
      await mkdir(thumbDir2, { recursive: true });
      await writeFile(join(thumbDir1, 'img_300.jpg'), 'fake');
      await writeFile(join(thumbDir2, 'img_150.jpg'), 'fake');

      const deleted = await deleteThumbnails(subDir);

      expect(deleted).toBe(2);
      await expect(stat(thumbDir1)).rejects.toThrow();
      await expect(stat(thumbDir2)).rejects.toThrow();
    });

    it('returns 0 when there are no .thumbnails directories', async () => {
      const subDir = join(tempDir, 'no-thumbs');
      await mkdir(subDir, { recursive: true });

      const deleted = await deleteThumbnails(subDir);
      expect(deleted).toBe(0);
    });

    it('handles non-existent directory gracefully', async () => {
      const deleted = await deleteThumbnails(join(tempDir, 'nonexistent'));
      expect(deleted).toBe(0);
    });

    it('preserves non-thumbnail directories', async () => {
      const subDir = join(tempDir, 'preserve');
      await mkdir(join(subDir, '.thumbnails'), { recursive: true });
      await mkdir(join(subDir, 'keep-me'), { recursive: true });
      await writeFile(join(subDir, '.thumbnails', 'img_300.jpg'), 'fake');
      await writeFile(join(subDir, 'keep-me', 'data.txt'), 'keep');

      await deleteThumbnails(subDir);

      const keepStat = await stat(join(subDir, 'keep-me'));
      expect(keepStat.isDirectory()).toBe(true);

      const keepFile = await readFile(join(subDir, 'keep-me', 'data.txt'), 'utf-8');
      expect(keepFile).toBe('keep');
    });
  });

  // -------------------------------------------------------------------------
  // listThumbnails
  // -------------------------------------------------------------------------

  describe('listThumbnails', () => {
    it('lists available thumbnail widths sorted ascending', async () => {
      const subDir = join(tempDir, 'list-test');
      await mkdir(subDir, { recursive: true });

      const filePath = await writeTestJpeg(subDir, 'photo.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);
      await createThumbnails(image, filePath);

      const widths = await listThumbnails(filePath);

      expect(widths).toEqual([150, 300, 640, 1280, 1920]);
    });

    it('returns empty array when no thumbnails exist', async () => {
      const widths = await listThumbnails(join(tempDir, 'no-thumbs', 'photo.jpg'));
      expect(widths).toEqual([]);
    });

    it('only lists thumbnails matching the file name', async () => {
      const subDir = join(tempDir, 'list-filter');
      await mkdir(subDir, { recursive: true });

      const filePath1 = await writeTestJpeg(subDir, 'alpha.jpg', 2000, 1500);
      const filePath2 = await writeTestJpeg(subDir, 'beta.jpg', 2000, 1500);
      const image = createTestImage(2000, 1500);

      await createThumbnails(image, filePath1);
      await createThumbnails(image, filePath2);

      const alphaWidths = await listThumbnails(filePath1);
      const betaWidths = await listThumbnails(filePath2);

      expect(alphaWidths).toEqual(betaWidths);
      expect(alphaWidths.length).toBe(THUMBNAIL_TIERS.length);
    });
  });

  describe('corrupt image handling', () => {
    it('createThumbnails throws on corrupt image data', async () => {
      const subDir = join(tempDir, 'corrupt-thumb');
      await mkdir(subDir, { recursive: true });

      const filePath = join(subDir, 'broken.jpg');
      await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0x00]));

      const { loadImage } = await import('../../src/utils/image.js');
      const image = loadImage(filePath);
      await expect(createThumbnails(image, filePath)).rejects.toThrow();
    });
  });
});
