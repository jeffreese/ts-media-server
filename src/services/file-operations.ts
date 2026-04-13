import { copyFile, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq, and, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'pino';

import * as schema from '../db/schema.js';
import { computeSha1 } from '../utils/file.js';
import { getThumbnailDirectory } from './thumbnail.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dependencies for {@link FileOperations}: SQLite handle and structured logger. */
export interface FileOperationsDeps {
  db: BetterSQLite3Database<typeof schema>;
  logger: Logger;
}

/** Summary of a successful {@link FileOperations.moveMediaItem} (primary files + thumbnail sidecars). */
export interface MoveResult {
  mediaItemId: number;
  filesMoved: number;
  thumbnailsMoved: number;
}

/**
 * Roll-up from {@link FileOperations.mergeDirectories}: how many items landed in the output,
 * how many were skipped (e.g. missing dates), and per-item failures after rollback attempts.
 */
export interface MergeResult {
  moved: number;
  skipped: number;
  errors: Array<{ mediaItemId: number; error: string }>;
}

interface FileRecord {
  id: number;
  name: string;
  extension: string | null;
  pathId: number;
}

interface CopiedFile {
  source: string;
  destination: string;
}

// ---------------------------------------------------------------------------
// FileOperations service
// ---------------------------------------------------------------------------

/**
 * Safe filesystem moves for catalog-backed media: copy-with-verification, thumbnail relocation,
 * and DB `path`/`file` updates, plus directory merge flows that rename into a single output tree.
 */
export class FileOperations {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly logger: Logger;

  constructor(deps: FileOperationsDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
  }

  // -------------------------------------------------------------------------
  // moveMediaItem
  // -------------------------------------------------------------------------

  /**
   * Move a media item and all associated files to a new directory.
   *
   * Strategy: copy-verify-delete. All files are copied first, their SHA1
   * checksums verified against the originals, and only then are the originals
   * removed. If any copy or verification fails, all copies are rolled back
   * (deleted) and the operation throws.
   */
  async moveMediaItem(mediaItemId: number, outputPath: string): Promise<MoveResult> {
    const files = this.getMediaItemFiles(mediaItemId);
    if (files.length === 0) {
      throw new Error(`No files found for media item ${mediaItemId}`);
    }

    await mkdir(outputPath, { recursive: true });

    const copied: CopiedFile[] = [];

    try {
      // Phase 1: Copy all associated files and verify checksums
      for (const file of files) {
        const sourceDir = this.getPathDir(file.pathId);
        const ext = file.extension ? `.${file.extension}` : '';
        const fileName = `${file.name}${ext}`;
        const sourcePath = join(sourceDir, fileName);
        const destPath = join(outputPath, fileName);

        if (!existsSync(sourcePath)) {
          throw new Error(`Source file not found: ${sourcePath}`);
        }

        const sourceHash = await computeSha1(sourcePath);
        await copyFile(sourcePath, destPath);
        const destHash = await computeSha1(destPath);

        if (sourceHash !== destHash) {
          throw new Error(
            `SHA1 checksum mismatch for ${fileName}: source=${sourceHash}, dest=${destHash}`,
          );
        }

        copied.push({ source: sourcePath, destination: destPath });
      }

      // Phase 2: Copy thumbnails
      const thumbnailsCopied = await this.copyThumbnails(files, outputPath);
      const thumbnailCopiedFiles = thumbnailsCopied.copied;

      // Phase 3: Delete originals now that all copies are verified
      for (const { source } of copied) {
        await unlink(source);
      }

      // Delete original thumbnails
      for (const { source } of thumbnailCopiedFiles) {
        try {
          await unlink(source);
        } catch {
          // Thumbnail may already be gone
        }
      }

      // Clean up empty source thumbnail directories
      await this.cleanupEmptyThumbnailDirs(files);

      // Phase 4: Update database records
      this.updateFilePathRecords(files, outputPath);

      return {
        mediaItemId,
        filesMoved: copied.length,
        thumbnailsMoved: thumbnailCopiedFiles.length,
      };
    } catch (error) {
      // Rollback: delete all copies
      this.logger.warn({ mediaItemId, error }, 'Move failed, rolling back copies');
      for (const { destination } of copied) {
        try {
          await unlink(destination);
        } catch {
          // Best-effort cleanup
        }
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // mergeDirectories
  // -------------------------------------------------------------------------

  /**
   * Combine media items from multiple source directories into a single
   * output directory, renaming files with date-based names (IMG_{timestamp}).
   * Media items without dates are skipped.
   */
  async mergeDirectories(
    inputPaths: string[],
    outputPath: string,
  ): Promise<MergeResult> {
    await mkdir(outputPath, { recursive: true });

    const mediaItems = this.getMediaItemsForDirectories(inputPaths);

    let moved = 0;
    let skipped = 0;
    const errors: Array<{ mediaItemId: number; error: string }> = [];
    const usedNames = new Set<string>();

    for (const item of mediaItems) {
      if (!item.startDate) {
        this.logger.debug({ mediaItemId: item.id }, 'Skipping media item without date');
        skipped++;
        continue;
      }

      const dateStr = this.formatDateForFilename(item.startDate);
      const files = this.getMediaItemFiles(item.id);
      if (files.length === 0) {
        skipped++;
        continue;
      }

      try {
        const itemCopies: Array<{ source: string; destination: string; fileId: number; uniqueName: string }> = [];

        // Phase 1: Copy all files for this media item and verify checksums
        for (const file of files) {
          const ext = file.extension ? `.${file.extension}` : '';
          const baseName = `IMG_${dateStr}`;
          const uniqueName = this.getUniqueName(baseName, ext, usedNames);
          usedNames.add(`${uniqueName}${ext}`.toLowerCase());

          const sourceDir = this.getPathDir(file.pathId);
          const sourceFileName = `${file.name}${ext}`;
          const sourcePath = join(sourceDir, sourceFileName);
          const destPath = join(outputPath, `${uniqueName}${ext}`);

          if (!existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
          }

          const sourceHash = await computeSha1(sourcePath);
          await copyFile(sourcePath, destPath);
          const destHash = await computeSha1(destPath);

          if (sourceHash !== destHash) {
            throw new Error(
              `SHA1 checksum mismatch for ${sourceFileName}: source=${sourceHash}, dest=${destHash}`,
            );
          }

          itemCopies.push({ source: sourcePath, destination: destPath, fileId: file.id, uniqueName });
        }

        // Phase 2: All copies verified — delete originals and update DB
        for (const copy of itemCopies) {
          await unlink(copy.source);
          const file = files.find((f) => f.id === copy.fileId)!;
          const pathRecord = this.getOrCreatePath(outputPath, file.pathId);
          this.db
            .update(schema.file)
            .set({ name: copy.uniqueName, pathId: pathRecord.id })
            .where(eq(schema.file.id, copy.fileId))
            .run();
        }

        // Move thumbnails for this media item
        await this.moveThumbnailsForMerge(files, outputPath);

        moved++;
      } catch (err) {
        // Rollback: remove any copies made for this media item
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error({ mediaItemId: item.id, error: message }, 'Failed to merge media item');

        // Clean up copied files on failure
        const destFiles = files.map((f) => {
          const ext = f.extension ? `.${f.extension}` : '';
          const baseName = `IMG_${dateStr}`;
          return join(outputPath, `${baseName}${ext}`);
        });
        for (const dest of destFiles) {
          try { await unlink(dest); } catch { /* may not exist */ }
        }

        errors.push({ mediaItemId: item.id, error: message });
      }
    }

    return { moved, skipped, errors };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getMediaItemFiles(mediaItemId: number): FileRecord[] {
    return this.db
      .select({
        id: schema.file.id,
        name: schema.file.name,
        extension: schema.file.extension,
        pathId: schema.file.pathId,
      })
      .from(schema.file)
      .innerJoin(
        schema.mediaItemFile,
        eq(schema.file.id, schema.mediaItemFile.fileId),
      )
      .where(eq(schema.mediaItemFile.mediaItemId, mediaItemId))
      .all();
  }

  private getPathDir(pathId: number): string {
    const pathRecord = this.db
      .select({ dir: schema.path.dir })
      .from(schema.path)
      .where(eq(schema.path.id, pathId))
      .get();

    if (!pathRecord) throw new Error(`Path record not found: ${pathId}`);
    return pathRecord.dir;
  }

  private async copyThumbnails(
    files: FileRecord[],
    outputPath: string,
  ): Promise<{ copied: CopiedFile[] }> {
    const copied: CopiedFile[] = [];
    const destThumbDir = join(outputPath, '.thumbnails');

    for (const file of files) {
      const sourceDir = this.getPathDir(file.pathId);
      const ext = file.extension ? `.${file.extension}` : '';
      const sourceFilePath = join(sourceDir, `${file.name}${ext}`);
      const sourceThumbDir = getThumbnailDirectory(sourceFilePath);

      if (!existsSync(sourceThumbDir)) continue;

      await mkdir(destThumbDir, { recursive: true });

      let entries;
      try {
        entries = await readdir(sourceThumbDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.startsWith(`${file.name}_`)) continue;

        const source = join(sourceThumbDir, entry);
        const dest = join(destThumbDir, entry);
        await copyFile(source, dest);
        copied.push({ source, destination: dest });
      }
    }

    return { copied };
  }

  private async cleanupEmptyThumbnailDirs(files: FileRecord[]): Promise<void> {
    const dirsToCheck = new Set<string>();

    for (const file of files) {
      const sourceDir = this.getPathDir(file.pathId);
      const ext = file.extension ? `.${file.extension}` : '';
      const thumbDir = getThumbnailDirectory(join(sourceDir, `${file.name}${ext}`));
      dirsToCheck.add(thumbDir);
    }

    for (const dir of dirsToCheck) {
      try {
        const entries = await readdir(dir);
        if (entries.length === 0) {
          await rm(dir, { recursive: true, force: true });
        }
      } catch {
        // Directory may not exist
      }
    }
  }

  private updateFilePathRecords(files: FileRecord[], outputPath: string): void {
    // Get the host ID from one of the existing path records
    const firstFile = files[0];
    const existingPath = this.db
      .select({ hostId: schema.path.hostId })
      .from(schema.path)
      .where(eq(schema.path.id, firstFile.pathId))
      .get();

    if (!existingPath) throw new Error(`Path record not found: ${firstFile.pathId}`);

    const pathRecord = this.getOrCreatePath(outputPath, firstFile.pathId);

    for (const file of files) {
      this.db
        .update(schema.file)
        .set({ pathId: pathRecord.id })
        .where(eq(schema.file.id, file.id))
        .run();
    }
  }

  private getOrCreatePath(
    dir: string,
    existingPathId: number,
  ): { id: number; dir: string } {
    const existingPath = this.db
      .select({ hostId: schema.path.hostId })
      .from(schema.path)
      .where(eq(schema.path.id, existingPathId))
      .get();

    if (!existingPath) throw new Error(`Path record not found: ${existingPathId}`);
    const hostId = existingPath.hostId;

    const existing = this.db
      .select({ id: schema.path.id, dir: schema.path.dir })
      .from(schema.path)
      .where(and(eq(schema.path.dir, dir), eq(schema.path.hostId, hostId)))
      .get();

    if (existing) return existing;

    return this.db
      .insert(schema.path)
      .values({ dir, hostId })
      .returning({ id: schema.path.id, dir: schema.path.dir })
      .get();
  }

  private getMediaItemsForDirectories(
    directories: string[],
  ): Array<{ id: number; startDate: string | null }> {
    const pathIds: number[] = [];

    for (const dir of directories) {
      const paths = this.db
        .select({ id: schema.path.id })
        .from(schema.path)
        .where(eq(schema.path.dir, dir))
        .all();
      pathIds.push(...paths.map((p) => p.id));
    }

    if (pathIds.length === 0) return [];

    const CHUNK_SIZE = 100;
    const fileRecords: Array<{ id: number }> = [];

    for (let i = 0; i < pathIds.length; i += CHUNK_SIZE) {
      const chunk = pathIds.slice(i, i + CHUNK_SIZE);
      const records = this.db
        .select({ id: schema.file.id })
        .from(schema.file)
        .where(inArray(schema.file.pathId, chunk))
        .all();
      fileRecords.push(...records);
    }

    const fileIds = fileRecords.map((f) => f.id);
    if (fileIds.length === 0) return [];

    const mediaItemIds = new Set<number>();

    for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
      const chunk = fileIds.slice(i, i + CHUNK_SIZE);
      const junctions = this.db
        .select({ mediaItemId: schema.mediaItemFile.mediaItemId })
        .from(schema.mediaItemFile)
        .where(inArray(schema.mediaItemFile.fileId, chunk))
        .all();
      for (const j of junctions) {
        mediaItemIds.add(j.mediaItemId);
      }
    }

    if (mediaItemIds.size === 0) return [];

    const ids = Array.from(mediaItemIds);
    const items: Array<{ id: number; startDate: string | null }> = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const records = this.db
        .select({ id: schema.mediaItem.id, startDate: schema.mediaItem.startDate })
        .from(schema.mediaItem)
        .where(inArray(schema.mediaItem.id, chunk))
        .all();
      items.push(...records);
    }

    return items;
  }

  private formatDateForFilename(date: string): string {
    // ISO 8601 → compact: "2024-06-15T14:30:00" → "20240615_143000"
    return date
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .replace(/\.\d+.*$/, '')
      .slice(0, 15);
  }

  /**
   * Find a unique filename by appending (2), (3), etc. when the base name
   * is already taken.
   */
  private getUniqueName(
    baseName: string,
    ext: string,
    usedNames: Set<string>,
  ): string {
    const key = `${baseName}${ext}`.toLowerCase();
    if (!usedNames.has(key)) return baseName;

    let suffix = 2;
    while (usedNames.has(`${baseName}(${suffix})${ext}`.toLowerCase())) {
      suffix++;
    }
    return `${baseName}(${suffix})`;
  }

  private async moveThumbnailsForMerge(
    files: FileRecord[],
    outputPath: string,
  ): Promise<void> {
    const destThumbDir = join(outputPath, '.thumbnails');

    for (const file of files) {
      const sourceDir = this.getPathDir(file.pathId);
      const ext = file.extension ? `.${file.extension}` : '';
      const sourceFilePath = join(sourceDir, `${file.name}${ext}`);
      const sourceThumbDir = getThumbnailDirectory(sourceFilePath);

      if (!existsSync(sourceThumbDir)) continue;

      await mkdir(destThumbDir, { recursive: true });

      let entries;
      try {
        entries = await readdir(sourceThumbDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.startsWith(`${file.name}_`)) continue;

        const source = join(sourceThumbDir, entry);
        try {
          await rename(source, join(destThumbDir, entry));
        } catch {
          // Cross-device move — fall back to copy+delete
          const dest = join(destThumbDir, entry);
          await copyFile(source, dest);
          await unlink(source).catch(() => {});
        }
      }

      // Clean up empty source thumbnail directory
      try {
        const remaining = await readdir(sourceThumbDir);
        if (remaining.length === 0) {
          await rm(sourceThumbDir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
  }
}
