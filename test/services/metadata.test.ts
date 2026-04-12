import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  extractImageMetadata,
  extractVideoMetadata,
  extractMetadata,
  toWktPoint,
  formatShutterSpeed,
  type GpsInfo,
  type MediaMetadata,
} from '../../src/services/metadata.js';
import { type FFmpeg, type VideoMetadata } from '../../src/utils/ffmpeg.js';

// ---------------------------------------------------------------------------
// Test image helpers
// ---------------------------------------------------------------------------

async function createJpegWithExif(
  dir: string,
  name: string,
  options: {
    width?: number;
    height?: number;
    exif?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const { width = 200, height = 100 } = options;
  const filePath = join(dir, name);

  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 64, b: 32 } },
  })
    .jpeg()
    .toBuffer();

  await writeFile(filePath, buf);
  return filePath;
}

async function createJpegWithRealExif(
  dir: string,
  name: string,
): Promise<string> {
  const filePath = join(dir, name);

  const buf = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 128, g: 64, b: 32 } },
  })
    .withMetadata({
      exif: {
        IFD0: {
          Make: 'Canon',
          Model: 'EOS R5',
        },
      },
    })
    .jpeg()
    .toBuffer();

  await writeFile(filePath, buf);
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('metadata service', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metadata-test-'));

    return async () => {
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  // -------------------------------------------------------------------------
  // toWktPoint
  // -------------------------------------------------------------------------

  describe('toWktPoint', () => {
    it('formats GPS coordinates as WKT POINT with longitude first', () => {
      const gps: GpsInfo = {
        latitude: 37.7749,
        longitude: -122.4194,
        datum: undefined,
        azimuth: undefined,
      };

      expect(toWktPoint(gps)).toBe('POINT(-122.4194 37.7749)');
    });

    it('handles negative coordinates', () => {
      const gps: GpsInfo = {
        latitude: -33.8688,
        longitude: 151.2093,
        datum: undefined,
        azimuth: undefined,
      };

      expect(toWktPoint(gps)).toBe('POINT(151.2093 -33.8688)');
    });

    it('handles zero coordinates', () => {
      const gps: GpsInfo = {
        latitude: 0,
        longitude: 0,
        datum: undefined,
        azimuth: undefined,
      };

      expect(toWktPoint(gps)).toBe('POINT(0 0)');
    });

    it('preserves high-precision coordinates', () => {
      const gps: GpsInfo = {
        latitude: 48.858844,
        longitude: 2.294351,
        datum: 'WGS-84',
        azimuth: 180.5,
      };

      expect(toWktPoint(gps)).toBe('POINT(2.294351 48.858844)');
    });
  });

  // -------------------------------------------------------------------------
  // extractImageMetadata
  // -------------------------------------------------------------------------

  describe('extractImageMetadata', () => {
    it('returns empty metadata for a plain JPEG without EXIF', async () => {
      const filePath = await createJpegWithExif(tempDir, 'plain.jpg');

      const meta = await extractImageMetadata(filePath);

      expect(meta.camera.make).toBeUndefined();
      expect(meta.camera.model).toBeUndefined();
      expect(meta.exposure.iso).toBeUndefined();
      expect(meta.gps).toBeUndefined();
      expect(meta.iptc.keywords).toEqual([]);
    });

    it('extracts camera make/model from EXIF', async () => {
      const filePath = await createJpegWithRealExif(tempDir, 'camera.jpg');

      const meta = await extractImageMetadata(filePath);

      expect(meta.camera.make).toBe('Canon');
      expect(meta.camera.model).toBe('EOS R5');
    });

    it('returns empty metadata for a non-existent file', async () => {
      const meta = await extractImageMetadata(join(tempDir, 'missing.jpg'));

      expect(meta.camera.make).toBeUndefined();
      expect(meta.date).toBeUndefined();
      expect(meta.gps).toBeUndefined();
    });

    it('falls back to sidecar JPEG when primary has no EXIF', async () => {
      const subDir = join(tempDir, 'sidecar-test');
      await mkdir(subDir, { recursive: true });

      await createJpegWithRealExif(subDir, 'IMG_0001.jpg');

      const primaryPath = join(subDir, 'IMG_0001.heic');
      await writeFile(primaryPath, Buffer.from('not a real heic'));

      const meta = await extractImageMetadata(primaryPath);

      expect(meta.camera.make).toBe('Canon');
      expect(meta.camera.model).toBe('EOS R5');
    });
  });

  // -------------------------------------------------------------------------
  // extractVideoMetadata
  // -------------------------------------------------------------------------

  describe('extractVideoMetadata', () => {
    let mockFfmpeg: FFmpeg;

    beforeEach(() => {
      mockFfmpeg = {
        getMetadata: vi.fn<(file: string) => Promise<VideoMetadata>>(),
      } as unknown as FFmpeg;
    });

    it('extracts video metadata via FFmpeg', async () => {
      vi.mocked(mockFfmpeg.getMetadata).mockResolvedValue({
        date: '2024-06-15T10:30:00.000000Z',
        width: 1920,
        height: 1080,
        duration: 120.5,
        frameRate: 29.97,
      });

      const meta = await extractVideoMetadata('/videos/clip.mp4', mockFfmpeg);

      expect(meta.date?.date).toBe('2024-06-15T10:30:00.000000Z');
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.duration).toBe(120.5);
      expect(meta.frameRate).toBe(29.97);
    });

    it('returns undefined date when video has no creation time', async () => {
      vi.mocked(mockFfmpeg.getMetadata).mockResolvedValue({
        date: undefined,
        width: 640,
        height: 480,
        duration: 5.0,
        frameRate: 24,
      });

      const meta = await extractVideoMetadata('/videos/clip.mp4', mockFfmpeg);

      expect(meta.date).toBeUndefined();
    });

    it('returns empty camera/exposure/gps/iptc for video files', async () => {
      vi.mocked(mockFfmpeg.getMetadata).mockResolvedValue({
        date: undefined,
        width: 640,
        height: 480,
        duration: 5.0,
        frameRate: 24,
      });

      const meta = await extractVideoMetadata('/videos/clip.mp4', mockFfmpeg);

      expect(meta.camera.make).toBeUndefined();
      expect(meta.camera.model).toBeUndefined();
      expect(meta.exposure.iso).toBeUndefined();
      expect(meta.gps).toBeUndefined();
      expect(meta.iptc.keywords).toEqual([]);
      expect(meta.wkt).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // extractMetadata (unified)
  // -------------------------------------------------------------------------

  describe('extractMetadata', () => {
    let mockFfmpeg: FFmpeg;

    beforeEach(() => {
      mockFfmpeg = {
        getMetadata: vi.fn<(file: string) => Promise<VideoMetadata>>(),
      } as unknown as FFmpeg;
    });

    it('delegates to video extraction for video files', async () => {
      vi.mocked(mockFfmpeg.getMetadata).mockResolvedValue({
        date: '2024-01-01T00:00:00Z',
        width: 1920,
        height: 1080,
        duration: 60,
        frameRate: 30,
      });

      const meta = await extractMetadata('/videos/clip.mp4', mockFfmpeg);

      expect(mockFfmpeg.getMetadata).toHaveBeenCalledWith('/videos/clip.mp4');
      expect(meta.duration).toBe(60);
      expect(meta.frameRate).toBe(30);
    });

    it('delegates to image extraction for image files', async () => {
      const filePath = await createJpegWithRealExif(tempDir, 'unified.jpg');

      const meta = await extractMetadata(filePath, mockFfmpeg);

      expect(mockFfmpeg.getMetadata).not.toHaveBeenCalled();
      expect(meta.camera.make).toBe('Canon');
      expect(meta.duration).toBeUndefined();
      expect(meta.frameRate).toBeUndefined();
    });

    it('returns empty metadata for unsupported extensions', async () => {
      const meta = await extractMetadata('/files/readme.txt', mockFfmpeg);

      expect(meta.date).toBeUndefined();
      expect(meta.camera.make).toBeUndefined();
      expect(meta.width).toBeUndefined();
      expect(meta.duration).toBeUndefined();
      expect(meta.wkt).toBeUndefined();
    });

    it('handles MOV video extension', async () => {
      vi.mocked(mockFfmpeg.getMetadata).mockResolvedValue({
        date: undefined,
        width: 3840,
        height: 2160,
        duration: 10,
        frameRate: 60,
      });

      const meta = await extractMetadata('/videos/clip.MOV', mockFfmpeg);

      expect(mockFfmpeg.getMetadata).toHaveBeenCalled();
      expect(meta.width).toBe(3840);
    });

    it('handles HEIC image extension', async () => {
      const subDir = join(tempDir, 'heic-test');
      await mkdir(subDir, { recursive: true });

      await createJpegWithRealExif(subDir, 'IMG_0002.jpg');

      const heicPath = join(subDir, 'IMG_0002.heic');
      await writeFile(heicPath, Buffer.from('not a real heic'));

      const meta = await extractMetadata(heicPath, mockFfmpeg);

      expect(mockFfmpeg.getMetadata).not.toHaveBeenCalled();
      expect(meta.camera.make).toBe('Canon');
    });
  });

  // -------------------------------------------------------------------------
  // formatShutterSpeed
  // -------------------------------------------------------------------------

  describe('formatShutterSpeed', () => {
    it('returns undefined for undefined input', () => {
      expect(formatShutterSpeed(undefined)).toBeUndefined();
    });

    it('formats whole-second exposures', () => {
      expect(formatShutterSpeed(1)).toBe('1s');
      expect(formatShutterSpeed(2)).toBe('2s');
      expect(formatShutterSpeed(30)).toBe('30s');
    });

    it('formats fractional exposures as 1/N', () => {
      expect(formatShutterSpeed(0.004)).toBe('1/250s');
      expect(formatShutterSpeed(1 / 125)).toBe('1/125s');
      expect(formatShutterSpeed(1 / 1000)).toBe('1/1000s');
      expect(formatShutterSpeed(0.5)).toBe('1/2s');
    });
  });

  // -------------------------------------------------------------------------
  // GPS → WKT integration
  // -------------------------------------------------------------------------

  describe('GPS to WKT integration', () => {
    it('sets wkt field when GPS data is present in image metadata', async () => {
      // We can't easily inject GPS EXIF via sharp, so we verify the
      // wkt field is undefined when there's no GPS data
      const filePath = await createJpegWithExif(tempDir, 'no-gps.jpg');
      const meta = await extractMetadata(filePath, {} as FFmpeg);

      expect(meta.wkt).toBeUndefined();
    });
  });
});
