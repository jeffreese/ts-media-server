import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  walkDirectory,
  groupFilesByName,
  identifyPrimaryFile,
  buildFileGroups,
  isHiddenDirectory,
  isImageExtension,
  isVideoExtension,
  isMediaExtension,
  isSidecarExtension,
  normalizePath,
  computeMd5,
  computeSha1,
  atomicWrite,
  createMediaFilter,
  type FileEntry,
} from '../../src/utils/file.js';

const TEST_DIR = join(import.meta.dirname, '.tmp-file-test');

function makeEntry(
  name: string,
  extension: string,
  dir = '/photos',
  size = 1_000_000,
): FileEntry {
  return {
    path: join(dir, `${name}.${extension}`),
    name,
    extension,
    size,
  };
}

// ---------------------------------------------------------------------------
// Extension classification
// ---------------------------------------------------------------------------

describe('extension classification', () => {
  it('identifies image extensions', () => {
    for (const ext of ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'tiff', 'tif', 'heic', 'heif']) {
      expect(isImageExtension(ext)).toBe(true);
    }
    expect(isImageExtension('mp4')).toBe(false);
    expect(isImageExtension('aae')).toBe(false);
  });

  it('identifies video extensions', () => {
    for (const ext of ['mov', 'mts', 'm4v', 'mp4', 'webm', 'ogg']) {
      expect(isVideoExtension(ext)).toBe(true);
    }
    expect(isVideoExtension('jpg')).toBe(false);
  });

  it('identifies media extensions (image or video)', () => {
    expect(isMediaExtension('jpg')).toBe(true);
    expect(isMediaExtension('mp4')).toBe(true);
    expect(isMediaExtension('aae')).toBe(false);
    expect(isMediaExtension('txt')).toBe(false);
  });

  it('identifies sidecar extensions', () => {
    expect(isSidecarExtension('aae')).toBe(true);
    expect(isSidecarExtension('AAE')).toBe(true);
    expect(isSidecarExtension('jpg')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isImageExtension('JPG')).toBe(true);
    expect(isVideoExtension('MOV')).toBe(true);
    expect(isMediaExtension('HEIC')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hidden directory detection
// ---------------------------------------------------------------------------

describe('isHiddenDirectory', () => {
  it('detects dot-prefixed directories', () => {
    expect(isHiddenDirectory('.thumbnails')).toBe(true);
    expect(isHiddenDirectory('.git')).toBe(true);
  });

  it('detects underscore-prefixed directories', () => {
    expect(isHiddenDirectory('_archive')).toBe(true);
    expect(isHiddenDirectory('_temp')).toBe(true);
  });

  it('allows normal directories', () => {
    expect(isHiddenDirectory('photos')).toBe(false);
    expect(isHiddenDirectory('2024-vacation')).toBe(false);
    expect(isHiddenDirectory('My Photos')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

describe('normalizePath', () => {
  it('resolves relative segments', () => {
    expect(normalizePath('/foo/bar/../baz')).toBe('/foo/baz');
    expect(normalizePath('/foo/./bar')).toBe('/foo/bar');
  });

  it('handles already-clean paths', () => {
    expect(normalizePath('/foo/bar/baz')).toBe('/foo/bar/baz');
  });
});

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

describe('walkDirectory', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('finds files recursively', async () => {
    await mkdir(join(TEST_DIR, 'sub'), { recursive: true });
    await writeFile(join(TEST_DIR, 'a.jpg'), 'data');
    await writeFile(join(TEST_DIR, 'sub', 'b.png'), 'data');

    const files = await walkDirectory(TEST_DIR);
    expect(files).toHaveLength(2);

    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('skips dot-prefixed directories', async () => {
    await mkdir(join(TEST_DIR, '.thumbnails'), { recursive: true });
    await writeFile(join(TEST_DIR, '.thumbnails', 'hidden.jpg'), 'data');
    await writeFile(join(TEST_DIR, 'visible.jpg'), 'data');

    const files = await walkDirectory(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('visible');
  });

  it('skips underscore-prefixed directories', async () => {
    await mkdir(join(TEST_DIR, '_archive'), { recursive: true });
    await writeFile(join(TEST_DIR, '_archive', 'old.jpg'), 'data');
    await writeFile(join(TEST_DIR, 'current.jpg'), 'data');

    const files = await walkDirectory(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('current');
  });

  it('applies file filter', async () => {
    await writeFile(join(TEST_DIR, 'photo.jpg'), 'data');
    await writeFile(join(TEST_DIR, 'readme.txt'), 'data');

    const filter = createMediaFilter();
    const files = await walkDirectory(TEST_DIR, filter);
    expect(files).toHaveLength(1);
    expect(files[0].extension).toBe('jpg');
  });

  it('returns empty array for empty directory', async () => {
    const files = await walkDirectory(TEST_DIR);
    expect(files).toEqual([]);
  });

  it('captures file size', async () => {
    const content = 'hello world';
    await writeFile(join(TEST_DIR, 'sized.jpg'), content);

    const files = await walkDirectory(TEST_DIR);
    expect(files[0].size).toBe(Buffer.byteLength(content));
  });

  it('parses extension correctly', async () => {
    await writeFile(join(TEST_DIR, 'photo.HEIC'), 'data');

    const files = await walkDirectory(TEST_DIR);
    expect(files[0].extension).toBe('HEIC');
    expect(files[0].name).toBe('photo');
  });
});

// ---------------------------------------------------------------------------
// File grouping
// ---------------------------------------------------------------------------

describe('groupFilesByName', () => {
  it('groups files with the same base name', () => {
    const files = [
      makeEntry('IMG_0001', 'heic'),
      makeEntry('IMG_0001', 'jpg'),
      makeEntry('IMG_0002', 'jpg'),
    ];

    const groups = groupFilesByName(files);
    expect(groups.size).toBe(2);

    const group1 = [...groups.values()].find((g) => g.length === 2);
    expect(group1).toBeDefined();
    expect(group1!.every((f) => f.name === 'IMG_0001')).toBe(true);
  });

  it('groups iPhone edited variants with originals', () => {
    const files = [
      makeEntry('IMG_0001', 'heic'),
      makeEntry('IMG_E0001', 'heic'),
    ];

    const groups = groupFilesByName(files);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });

  it('keeps files from different directories separate', () => {
    const files = [
      makeEntry('IMG_0001', 'jpg', '/photos/a'),
      makeEntry('IMG_0001', 'jpg', '/photos/b'),
    ];

    const groups = groupFilesByName(files);
    expect(groups.size).toBe(2);
  });

  it('groups sidecars with their media files', () => {
    const files = [
      makeEntry('IMG_0001', 'heic'),
      makeEntry('IMG_0001', 'aae'),
      makeEntry('IMG_0001', 'mov', '/photos', 2_000_000),
    ];

    const groups = groupFilesByName(files);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Primary file identification
// ---------------------------------------------------------------------------

describe('identifyPrimaryFile', () => {
  it('returns the only file when group has one entry', () => {
    const file = makeEntry('IMG_0001', 'jpg');
    expect(identifyPrimaryFile([file])).toBe(file);
  });

  it('prioritizes HEIC over JPEG', () => {
    const heic = makeEntry('IMG_0001', 'heic');
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([jpg, heic])).toBe(heic);
    expect(identifyPrimaryFile([heic, jpg])).toBe(heic);
  });

  it('prioritizes HEIF over JPEG', () => {
    const heif = makeEntry('IMG_0001', 'heif');
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([jpg, heif])).toBe(heif);
  });

  it('prioritizes non-JPEG media over JPEG', () => {
    const png = makeEntry('IMG_0001', 'png');
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([jpg, png])).toBe(png);
  });

  it('prioritizes video over JPEG when video is not a short MOV', () => {
    const mp4 = makeEntry('IMG_0001', 'mp4', '/photos', 10_000_000);
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([jpg, mp4])).toBe(mp4);
  });

  it('skips short MOV sidecars (Live Photo clips)', () => {
    const jpg = makeEntry('IMG_0001', 'jpg');
    const shortMov = makeEntry('IMG_0001', 'mov', '/photos', 2_000_000);

    expect(identifyPrimaryFile([shortMov, jpg])).toBe(jpg);
  });

  it('never selects AAE sidecar as primary', () => {
    const aae = makeEntry('IMG_0001', 'aae');
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([aae, jpg])).toBe(jpg);
  });

  it('falls back to first file when all are sidecars', () => {
    const aae = makeEntry('IMG_0001', 'aae');
    const shortMov = makeEntry('IMG_0001', 'mov', '/photos', 1_000);

    expect(identifyPrimaryFile([aae, shortMov])).toBe(aae);
  });

  it('selects HEIC even when AAE and short MOV are present', () => {
    const heic = makeEntry('IMG_0001', 'heic');
    const aae = makeEntry('IMG_0001', 'aae');
    const shortMov = makeEntry('IMG_0001', 'mov', '/photos', 2_000_000);
    const jpg = makeEntry('IMG_0001', 'jpg');

    expect(identifyPrimaryFile([aae, shortMov, jpg, heic])).toBe(heic);
  });
});

// ---------------------------------------------------------------------------
// buildFileGroups
// ---------------------------------------------------------------------------

describe('buildFileGroups', () => {
  it('builds groups with primary file identified', () => {
    const files = [
      makeEntry('IMG_0001', 'heic'),
      makeEntry('IMG_0001', 'jpg'),
      makeEntry('IMG_0002', 'png'),
    ];

    const groups = buildFileGroups(files);
    expect(groups).toHaveLength(2);

    const group1 = groups.find((g) => g.baseName === 'IMG_0001');
    expect(group1).toBeDefined();
    expect(group1!.files).toHaveLength(2);
    expect(group1!.primary.extension).toBe('heic');

    const group2 = groups.find((g) => g.baseName === 'IMG_0002');
    expect(group2).toBeDefined();
    expect(group2!.files).toHaveLength(1);
    expect(group2!.primary.extension).toBe('png');
  });

  it('normalizes iPhone edited variant names', () => {
    const files = [
      makeEntry('IMG_0001', 'heic'),
      makeEntry('IMG_E0001', 'heic'),
    ];

    const groups = buildFileGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseName).toBe('IMG_0001');
  });
});

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

describe('hash computation', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('computes MD5 hash', async () => {
    const filePath = join(TEST_DIR, 'test.bin');
    await writeFile(filePath, 'hello world');

    const hash = await computeMd5(filePath);
    expect(hash).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('computes SHA1 hash', async () => {
    const filePath = join(TEST_DIR, 'test.bin');
    await writeFile(filePath, 'hello world');

    const hash = await computeSha1(filePath);
    expect(hash).toBe('2aae6c35c94fcfb415dbe95f408b9ce91ee846ed');
  });

  it('produces different hashes for different content', async () => {
    const file1 = join(TEST_DIR, 'a.bin');
    const file2 = join(TEST_DIR, 'b.bin');
    await writeFile(file1, 'content a');
    await writeFile(file2, 'content b');

    const hash1 = await computeMd5(file1);
    const hash2 = await computeMd5(file2);
    expect(hash1).not.toBe(hash2);
  });

  it('produces consistent hashes for same content', async () => {
    const file1 = join(TEST_DIR, 'a.bin');
    const file2 = join(TEST_DIR, 'b.bin');
    await writeFile(file1, 'same content');
    await writeFile(file2, 'same content');

    expect(await computeMd5(file1)).toBe(await computeMd5(file2));
    expect(await computeSha1(file1)).toBe(await computeSha1(file2));
  });

  it('rejects on missing file', async () => {
    await expect(computeMd5(join(TEST_DIR, 'nonexistent'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

describe('atomicWrite', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes string data atomically', async () => {
    const target = join(TEST_DIR, 'output.txt');
    await atomicWrite(target, 'hello');

    const content = await readFile(target, 'utf-8');
    expect(content).toBe('hello');
  });

  it('writes buffer data atomically', async () => {
    const target = join(TEST_DIR, 'output.bin');
    const data = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await atomicWrite(target, data);

    const content = await readFile(target);
    expect(content).toEqual(data);
  });

  it('overwrites existing files', async () => {
    const target = join(TEST_DIR, 'output.txt');
    await writeFile(target, 'old');
    await atomicWrite(target, 'new');

    const content = await readFile(target, 'utf-8');
    expect(content).toBe('new');
  });

  it('does not leave temp files on success', async () => {
    const target = join(TEST_DIR, 'output.txt');
    await atomicWrite(target, 'data');

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(TEST_DIR);
    expect(files).toEqual(['output.txt']);
  });
});

// ---------------------------------------------------------------------------
// createMediaFilter
// ---------------------------------------------------------------------------

describe('createMediaFilter', () => {
  it('accepts image files', () => {
    const filter = createMediaFilter();
    expect(filter(makeEntry('photo', 'jpg'))).toBe(true);
    expect(filter(makeEntry('photo', 'heic'))).toBe(true);
    expect(filter(makeEntry('photo', 'png'))).toBe(true);
  });

  it('accepts video files', () => {
    const filter = createMediaFilter();
    expect(filter(makeEntry('video', 'mp4'))).toBe(true);
    expect(filter(makeEntry('video', 'mov'))).toBe(true);
  });

  it('accepts sidecar files', () => {
    const filter = createMediaFilter();
    expect(filter(makeEntry('photo', 'aae'))).toBe(true);
  });

  it('rejects non-media files', () => {
    const filter = createMediaFilter();
    expect(filter(makeEntry('readme', 'txt'))).toBe(false);
    expect(filter(makeEntry('data', 'json'))).toBe(false);
    expect(filter(makeEntry('script', 'sh'))).toBe(false);
  });
});
