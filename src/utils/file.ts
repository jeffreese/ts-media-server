import { readdir, stat, rename, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, parse, normalize, sep, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string;
  name: string;
  extension: string;
  size: number;
}

export interface FileGroup {
  baseName: string;
  directory: string;
  files: FileEntry[];
  primary: FileEntry;
}

export type FileFilter = (entry: FileEntry) => boolean;

// ---------------------------------------------------------------------------
// Supported extensions (used for default filtering and classification)
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif',
  'png',
  'webp',
  'tiff', 'tif',
  'heic', 'heif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mov', 'mts', 'm4v', 'mp4', 'webm', 'ogg',
]);

const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg', 'jpe', 'jfif']);

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

/**
 * iPhone sidecar extensions that should be grouped with the primary file
 * but never selected as primary.
 */
const SIDECAR_EXTENSIONS = new Set(['aae']);

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

export function isMediaExtension(ext: string): boolean {
  return isImageExtension(ext) || isVideoExtension(ext);
}

export function isSidecarExtension(ext: string): boolean {
  return SIDECAR_EXTENSIONS.has(ext.toLowerCase());
}

// ---------------------------------------------------------------------------
// Hidden directory detection
// ---------------------------------------------------------------------------

export function isHiddenDirectory(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_');
}

// ---------------------------------------------------------------------------
// Cross-platform path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a path to use forward slashes and resolve `.` / `..` segments.
 * On Windows this converts backslashes; on POSIX it's effectively a no-op
 * beyond resolving relative segments.
 */
export function normalizePath(filePath: string): string {
  const normalized = normalize(filePath);
  if (sep === '\\') {
    return normalized.replace(/\\/g, '/');
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Async recursive directory walker
// ---------------------------------------------------------------------------

export async function walkDirectory(
  directory: string,
  filter?: FileFilter,
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  await walkRecursive(directory, results, filter);
  return results;
}

async function walkRecursive(
  directory: string,
  results: FileEntry[],
  filter?: FileFilter,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!isHiddenDirectory(entry.name)) {
        await walkRecursive(fullPath, results, filter);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const parsed = parse(entry.name);
    const extension = parsed.ext.replace(/^\./, '');
    const fileStat = await stat(fullPath);

    const fileEntry: FileEntry = {
      path: fullPath,
      name: parsed.name,
      extension,
      size: fileStat.size,
    };

    if (!filter || filter(fileEntry)) {
      results.push(fileEntry);
    }
  }
}

// ---------------------------------------------------------------------------
// File grouping
// ---------------------------------------------------------------------------

/**
 * Strips iPhone editing prefixes (e.g. "IMG_E0001" → "IMG_0001") so edited
 * variants group with their originals.
 */
function normalizeBaseName(name: string): string {
  return name.replace(/^IMG_E(\d+)$/, 'IMG_$1');
}

/**
 * Groups files by their base name (filename without extension) so that
 * related files (HEIC + JPG, MOV + MP4, iPhone sidecars) are processed
 * together.
 */
export function groupFilesByName(files: FileEntry[]): Map<string, FileEntry[]> {
  const groups = new Map<string, FileEntry[]>();

  for (const file of files) {
    const key = `${dirname(file.path)}${sep}${normalizeBaseName(file.name)}`;
    const group = groups.get(key);
    if (group) {
      group.push(file);
    } else {
      groups.set(key, [file]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Primary file identification
// ---------------------------------------------------------------------------

/**
 * Short MOV sidecars (iPhone Live Photo clips, typically ≤3 seconds / small
 * size) should not be selected as primary. We use a 5 MB heuristic — real
 * video files are almost always larger.
 */
const SHORT_MOV_SIZE_THRESHOLD = 5 * 1024 * 1024;

function isShortMovSidecar(file: FileEntry): boolean {
  return file.extension.toLowerCase() === 'mov' && file.size < SHORT_MOV_SIZE_THRESHOLD;
}

/**
 * Select the primary file from a group of related files.
 *
 * Priority order:
 *  1. HEIC/HEIF (highest fidelity from Apple devices)
 *  2. Non-JPEG images and non-short-MOV videos
 *  3. JPEG (common sidecar / fallback)
 *
 * Sidecars (AAE) and short MOV clips are never selected as primary.
 */
export function identifyPrimaryFile(files: FileEntry[]): FileEntry {
  if (files.length === 1) return files[0];

  const candidates = files.filter(
    (f) => !isSidecarExtension(f.extension) && !isShortMovSidecar(f),
  );

  if (candidates.length === 0) return files[0];

  const heic = candidates.find((f) => HEIC_EXTENSIONS.has(f.extension.toLowerCase()));
  if (heic) return heic;

  const nonJpeg = candidates.find(
    (f) => isMediaExtension(f.extension) && !JPEG_EXTENSIONS.has(f.extension.toLowerCase()),
  );
  if (nonJpeg) return nonJpeg;

  return candidates[0];
}

/**
 * Group files by name and identify the primary file for each group.
 */
export function buildFileGroups(files: FileEntry[]): FileGroup[] {
  const grouped = groupFilesByName(files);
  const result: FileGroup[] = [];

  for (const [key, groupFiles] of grouped) {
    const primary = identifyPrimaryFile(groupFiles);
    result.push({
      baseName: normalizeBaseName(groupFiles[0].name),
      directory: dirname(key),
      files: groupFiles,
      primary,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

export async function computeMd5(filePath: string): Promise<string> {
  return computeFileHash(filePath, 'md5');
}

export async function computeSha1(filePath: string): Promise<string> {
  return computeFileHash(filePath, 'sha1');
}

function computeFileHash(filePath: string, algorithm: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

/**
 * Write data to a file atomically: writes to a temp file in the same
 * directory, then renames to the target path. This prevents partial writes
 * from being visible.
 */
export async function atomicWrite(
  targetPath: string,
  data: Buffer | string,
): Promise<void> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, `.tmp-${randomUUID()}`);

  try {
    await writeFile(tempPath, data);
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Default media file filter
// ---------------------------------------------------------------------------

export function createMediaFilter(): FileFilter {
  return (entry) =>
    isMediaExtension(entry.extension) || isSidecarExtension(entry.extension);
}
