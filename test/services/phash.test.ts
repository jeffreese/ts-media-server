import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computeHash, hammingDistance } from '../../src/services/phash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSolidImage(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): sharp.Sharp {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).rotate();
}

function createGradientImage(width: number, height: number): sharp.Sharp {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      pixels[idx] = Math.round((x / width) * 255);
      pixels[idx + 1] = Math.round((y / height) * 255);
      pixels[idx + 2] = 128;
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } }).rotate();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phash service', () => {
  // -------------------------------------------------------------------------
  // computeHash
  // -------------------------------------------------------------------------

  describe('computeHash', () => {
    it('returns a 64-character binary string', async () => {
      const image = createSolidImage(100, 100, { r: 128, g: 128, b: 128 });
      const hash = await computeHash(image);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[01]+$/);
    });

    it('produces identical hashes for the same image', async () => {
      const image = createGradientImage(200, 200);

      const hash1 = await computeHash(image);
      const hash2 = await computeHash(image);

      expect(hash1).toBe(hash2);
    });

    it('produces similar hashes for different resolutions of the same content', async () => {
      const small = createGradientImage(100, 100);
      const large = createGradientImage(800, 800);

      const hashSmall = await computeHash(small);
      const hashLarge = await computeHash(large);

      const distance = hammingDistance(hashSmall, hashLarge);
      expect(distance).toBeLessThanOrEqual(10);
    });

    it('produces different hashes for visually distinct images', async () => {
      const dark = createSolidImage(200, 200, { r: 10, g: 10, b: 10 });
      const gradient = createGradientImage(200, 200);

      const hashDark = await computeHash(dark);
      const hashGradient = await computeHash(gradient);

      expect(hashDark).not.toBe(hashGradient);
    });

    it('produces similar hashes for slightly shifted gradients', async () => {
      const a = createGradientImage(200, 200);

      // Slightly shifted version: offset the gradient by a small amount
      const pixels = Buffer.alloc(200 * 200 * 3);
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x < 200; x++) {
          const idx = (y * 200 + x) * 3;
          pixels[idx] = Math.min(255, Math.round((x / 200) * 255) + 5);
          pixels[idx + 1] = Math.min(255, Math.round((y / 200) * 255) + 5);
          pixels[idx + 2] = 130;
        }
      }
      const b = sharp(pixels, { raw: { width: 200, height: 200, channels: 3 } }).rotate();

      const hashA = await computeHash(a);
      const hashB = await computeHash(b);

      const distance = hammingDistance(hashA, hashB);
      expect(distance).toBeLessThanOrEqual(10);
    });

    it('handles very small images', async () => {
      const tiny = createSolidImage(8, 8, { r: 200, g: 100, b: 50 });
      const hash = await computeHash(tiny);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[01]+$/);
    });

    it('handles non-square images', async () => {
      const wide = createSolidImage(400, 100, { r: 100, g: 100, b: 100 });
      const tall = createSolidImage(100, 400, { r: 100, g: 100, b: 100 });

      const hashWide = await computeHash(wide);
      const hashTall = await computeHash(tall);

      expect(hashWide).toHaveLength(64);
      expect(hashTall).toHaveLength(64);
    });
  });

  // -------------------------------------------------------------------------
  // hammingDistance
  // -------------------------------------------------------------------------

  describe('hammingDistance', () => {
    it('returns 0 for identical hashes', () => {
      const hash = '1'.repeat(64);
      expect(hammingDistance(hash, hash)).toBe(0);
    });

    it('returns 64 for completely opposite hashes', () => {
      const a = '0'.repeat(64);
      const b = '1'.repeat(64);
      expect(hammingDistance(a, b)).toBe(64);
    });

    it('counts the number of differing positions', () => {
      const a = '1100' + '0'.repeat(60);
      const b = '1010' + '0'.repeat(60);
      expect(hammingDistance(a, b)).toBe(2);
    });

    it('is symmetric', () => {
      const a = '10101010'.repeat(8);
      const b = '01010101'.repeat(8);
      expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
    });

    it('throws on length mismatch', () => {
      expect(() => hammingDistance('101', '1010')).toThrow('Hash length mismatch');
    });

    it('works with all-zero hashes', () => {
      const zeros = '0'.repeat(64);
      expect(hammingDistance(zeros, zeros)).toBe(0);
    });

    it('correctly handles single-bit difference', () => {
      const a = '0'.repeat(64);
      const b = '0'.repeat(63) + '1';
      expect(hammingDistance(a, b)).toBe(1);
    });
  });
});
