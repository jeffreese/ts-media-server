import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import pLimit from 'p-limit';
import { eq, and, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { InferenceSession } from 'onnxruntime-node';
import type { Logger } from 'pino';

import * as schema from '../db/schema.js';
import {
  walkDirectory,
  buildFileGroups,
  computeMd5,
  isHiddenDirectory,
  isVideoExtension,
  isImageExtension,
  type FileEntry,
  type FileFilter,
  type FileGroup,
} from '../utils/file.js';
import { loadImage } from '../utils/image.js';
import { type FFmpeg } from '../utils/ffmpeg.js';
import { extractMetadata, type MediaMetadata } from './metadata.js';
import { computeHash } from './phash.js';
import { createThumbnails, getThumbnailDirectory, deleteThumbnails } from './thumbnail.js';
import { detectFaces, serializeDetection } from './face-detection.js';
import { recognizeFace } from './face-recognition.js';
import { HashMatcher } from './hash-matcher.js';
import { FaceMatcher } from './face-matcher.js';
import { type NotificationService } from './notification.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileIndexDeps {
  db: BetterSQLite3Database<typeof schema>;
  ffmpeg: FFmpeg;
  notifications: NotificationService;
  logger: Logger;
  detectionSession?: InferenceSession;
  recognitionSession?: InferenceSession;
}

export interface AddDirectoryOptions {
  directory: string;
  fileFilter?: FileFilter;
  concurrency?: number;
  hostId?: number;
}

interface PathRecord {
  id: number;
  dir: string;
}

// ---------------------------------------------------------------------------
// Default host
// ---------------------------------------------------------------------------

const DEFAULT_HOST_NAME = 'localhost';

function getOrCreateHost(
  db: BetterSQLite3Database<typeof schema>,
  name: string = DEFAULT_HOST_NAME,
): number {
  const existing = db
    .select({ id: schema.host.id })
    .from(schema.host)
    .where(eq(schema.host.name, name))
    .get();

  if (existing) return existing.id;

  return db
    .insert(schema.host)
    .values({ name })
    .returning({ id: schema.host.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// FileIndex service
// ---------------------------------------------------------------------------

export class FileIndex {
  private readonly db: BetterSQLite3Database<typeof schema>;
  private readonly ffmpeg: FFmpeg;
  private readonly notifications: NotificationService;
  private readonly logger: Logger;
  private readonly detectionSession?: InferenceSession;
  private readonly recognitionSession?: InferenceSession;
  private readonly hashMatcher: HashMatcher;
  private readonly faceMatcher: FaceMatcher;

  constructor(deps: FileIndexDeps) {
    this.db = deps.db;
    this.ffmpeg = deps.ffmpeg;
    this.notifications = deps.notifications;
    this.logger = deps.logger;
    this.detectionSession = deps.detectionSession;
    this.recognitionSession = deps.recognitionSession;
    this.hashMatcher = new HashMatcher(deps.db);
    this.faceMatcher = new FaceMatcher(deps.db);
  }

  // -------------------------------------------------------------------------
  // Path & File Registration
  // -------------------------------------------------------------------------

  /**
   * Scan a directory for subdirectories containing media files and register
   * them as `path` records in the database. Returns the created/existing
   * path IDs.
   */
  async addPaths(
    directory: string,
    hostId: number,
    fileFilter?: FileFilter,
  ): Promise<PathRecord[]> {
    const files = await walkDirectory(directory, fileFilter);
    const dirSet = new Set<string>();

    for (const file of files) {
      dirSet.add(dirname(file.path));
    }

    const pathRecords: PathRecord[] = [];

    for (const dir of dirSet) {
      const existing = this.db
        .select({ id: schema.path.id, dir: schema.path.dir })
        .from(schema.path)
        .where(and(eq(schema.path.dir, dir), eq(schema.path.hostId, hostId)))
        .get();

      if (existing) {
        pathRecords.push(existing);
        continue;
      }

      const inserted = this.db
        .insert(schema.path)
        .values({ dir, hostId })
        .returning({ id: schema.path.id, dir: schema.path.dir })
        .get();

      pathRecords.push(inserted);
    }

    return pathRecords;
  }

  /**
   * Create `file` records for media files in the given paths, grouping
   * related files by name. Returns ordered file groups with their DB IDs.
   */
  async addFiles(
    pathRecords: PathRecord[],
    fileFilter?: FileFilter,
  ): Promise<Array<{ group: FileGroup; fileIds: number[] }>> {
    const allFiles: FileEntry[] = [];

    for (const pathRecord of pathRecords) {
      const files = await walkDirectory(pathRecord.dir, fileFilter);
      const dirFiles = files.filter((f) => dirname(f.path) === pathRecord.dir);
      allFiles.push(...dirFiles);
    }

    const groups = buildFileGroups(allFiles);
    const result: Array<{ group: FileGroup; fileIds: number[] }> = [];

    for (const group of groups) {
      const fileIds: number[] = [];

      for (const file of group.files) {
        const pathRecord = pathRecords.find((p) => p.dir === dirname(file.path));
        if (!pathRecord) continue;

        const hash = await computeMd5(file.path);

        const existing = this.db
          .select({ id: schema.file.id })
          .from(schema.file)
          .where(
            and(
              eq(schema.file.pathId, pathRecord.id),
              eq(schema.file.name, file.name),
              eq(schema.file.extension, file.extension),
            ),
          )
          .get();

        if (existing) {
          this.db
            .update(schema.file)
            .set({ size: file.size, hash })
            .where(eq(schema.file.id, existing.id))
            .run();
          fileIds.push(existing.id);
        } else {
          const ext = file.extension.toLowerCase();
          const type = isVideoExtension(ext) ? 'video' : isImageExtension(ext) ? 'image' : 'other';

          const inserted = this.db
            .insert(schema.file)
            .values({
              name: file.name,
              extension: file.extension,
              pathId: pathRecord.id,
              type,
              size: file.size,
              hash,
            })
            .returning({ id: schema.file.id })
            .get();

          fileIds.push(inserted.id);
        }
      }

      result.push({ group, fileIds });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Media Item Creation
  // -------------------------------------------------------------------------

  /**
   * Create or update a media item from a file group: extract metadata,
   * compute perceptual hash, generate thumbnails, detect faces, and
   * create all necessary DB records.
   */
  async createMediaItem(
    group: FileGroup,
    fileIds: number[],
    folderId: number,
    folderIndex: number,
  ): Promise<{ mediaItemId: number; faceMatchPromises: Promise<void>[] } | undefined> {
    const primary = group.primary;
    const ext = primary.extension.toLowerCase();

    let image: ReturnType<typeof loadImage> | undefined;
    let metadata: MediaMetadata;

    try {
      if (isVideoExtension(ext)) {
        metadata = await extractMetadata(primary.path, this.ffmpeg);

        const framePath = primary.path.replace(extname(primary.path), '_frame.jpg');
        try {
          await this.ffmpeg.createJPEG(primary.path, framePath);
          image = loadImage(framePath);
        } catch (err) {
          this.logger.warn({ file: primary.path, err }, 'Failed to extract video frame');
        }
      } else {
        image = loadImage(primary.path);
        metadata = await extractMetadata(primary.path, this.ffmpeg);
      }
    } catch (err) {
      this.logger.error({ file: primary.path, err }, 'Failed to extract metadata');
      return undefined;
    }

    // Compute perceptual hash
    let pHash: string | undefined;
    if (image) {
      try {
        pHash = await computeHash(image);
      } catch (err) {
        this.logger.warn({ file: primary.path, err }, 'Failed to compute perceptual hash');
      }
    }

    // Generate thumbnails
    if (image) {
      try {
        await createThumbnails(image, primary.path);
      } catch (err) {
        this.logger.warn({ file: primary.path, err }, 'Failed to generate thumbnails');
      }
    }

    // Create MP4 for non-MP4 video files
    if (isVideoExtension(ext) && ext !== 'mp4') {
      const mp4Path = primary.path.replace(extname(primary.path), '.mp4');
      try {
        await this.ffmpeg.createMP4(primary.path, mp4Path);
      } catch (err) {
        this.logger.warn({ file: primary.path, err }, 'Failed to create MP4');
      }
    }

    // Build media item info
    const info: Record<string, unknown> = {};
    if (metadata.camera.make || metadata.camera.model) {
      info.camera = metadata.camera;
    }
    if (metadata.exposure.iso || metadata.exposure.focalLength) {
      info.exposure = metadata.exposure;
    }
    if (metadata.iptc.keywords.length > 0 || metadata.iptc.headline) {
      info.iptc = metadata.iptc;
    }
    if (metadata.duration != null) {
      info.duration = metadata.duration;
    }
    if (metadata.frameRate != null) {
      info.frameRate = metadata.frameRate;
    }
    if (metadata.width != null && metadata.height != null) {
      info.dimensions = { width: metadata.width, height: metadata.height };
    }

    const type = isVideoExtension(ext) ? 'video' : 'image';
    const startDate = metadata.date?.date;

    // Check for existing media item linked to these files
    const existingLink = this.db
      .select({ mediaItemId: schema.mediaItemFile.mediaItemId })
      .from(schema.mediaItemFile)
      .where(inArray(schema.mediaItemFile.fileId, fileIds))
      .get();

    let mediaItemId: number;

    if (existingLink) {
      mediaItemId = existingLink.mediaItemId;
      this.db
        .update(schema.mediaItem)
        .set({
          name: group.baseName,
          type,
          startDate,
          endDate: startDate,
          hash: pHash ?? undefined,
          info: Object.keys(info).length > 0 ? info : undefined,
        })
        .where(eq(schema.mediaItem.id, mediaItemId))
        .run();
    } else {
      mediaItemId = this.db
        .insert(schema.mediaItem)
        .values({
          name: group.baseName,
          type,
          startDate,
          endDate: startDate,
          hash: pHash,
          info: Object.keys(info).length > 0 ? info : undefined,
        })
        .returning({ id: schema.mediaItem.id })
        .get().id;
    }

    // Create media_item_file junction records
    const primaryIndex = group.files.indexOf(primary);
    for (let i = 0; i < fileIds.length; i++) {
      this.db
        .insert(schema.mediaItemFile)
        .values({
          mediaItemId,
          fileId: fileIds[i],
          isPrimary: i === primaryIndex,
        })
        .onConflictDoNothing()
        .run();
    }

    // Create folder_entry
    this.db
      .insert(schema.folderEntry)
      .values({ folderId, itemId: mediaItemId, index: folderIndex })
      .onConflictDoNothing()
      .run();

    // Face detection
    const faceMatchPromises: Promise<void>[] = [];

    if (image && this.detectionSession) {
      try {
        const faces = await detectFaces(this.detectionSession, image);
        for (const face of faces) {
          const featureInfo: Record<string, unknown> = {
            ...serializeDetection(face.detection),
          };

          // Face recognition embedding
          if (this.recognitionSession) {
            try {
              const embedding = await recognizeFace(
                this.recognitionSession,
                image,
                face.detection.landmarks,
              );
              featureInfo.embedding = Array.from(embedding);
            } catch (err) {
              this.logger.warn({ file: primary.path, err }, 'Failed to extract face embedding');
            }
          }

          const featureId = this.db
            .insert(schema.feature)
            .values({
              itemId: mediaItemId,
              coordinates: serializeDetection(face.detection),
              thumbnail: face.thumbnail,
              info: featureInfo,
            })
            .returning({ id: schema.feature.id })
            .get().id;

          // Queue face matching
          if (featureInfo.embedding) {
            const embedding = new Float32Array(featureInfo.embedding as number[]);
            const promise = this.faceMatcher
              .matchFace(featureId, embedding)
              .catch((err: unknown) => {
                this.logger.warn({ featureId, err }, 'Face matching failed');
              })
              .then(() => {});
            faceMatchPromises.push(promise);
          }
        }
      } catch (err) {
        this.logger.warn({ file: primary.path, err }, 'Face detection failed');
      }
    }

    this.notifications.notify('create', 'mediaItem', { id: mediaItemId, name: group.baseName });

    return { mediaItemId, faceMatchPromises };
  }

  // -------------------------------------------------------------------------
  // Folder Management
  // -------------------------------------------------------------------------

  /**
   * Mirror a filesystem directory as a virtual folder in the database.
   * Creates the folder if it doesn't exist, returns the folder ID.
   */
  getOrCreateFolder(
    directoryName: string,
    parentFolderId: number | null,
  ): number {
    const existing = parentFolderId === null
      ? this.db
          .select({ id: schema.folder.id })
          .from(schema.folder)
          .where(eq(schema.folder.name, directoryName))
          .get()
      : this.db
          .select({ id: schema.folder.id })
          .from(schema.folder)
          .where(
            and(
              eq(schema.folder.name, directoryName),
              eq(schema.folder.parentId, parentFolderId),
            ),
          )
          .get();

    if (existing) return existing.id;

    return this.db
      .insert(schema.folder)
      .values({
        name: directoryName,
        parentId: parentFolderId,
      })
      .returning({ id: schema.folder.id })
      .get().id;
  }

  /**
   * Build the folder hierarchy for a given directory path relative to
   * the root indexing directory. Returns the leaf folder ID.
   */
  private buildFolderHierarchy(
    directory: string,
    rootDirectory: string,
    rootFolderId: number,
  ): number {
    const relative = directory.slice(rootDirectory.length).replace(/^\//, '');
    if (!relative) return rootFolderId;

    const parts = relative.split('/').filter(Boolean);
    let parentId = rootFolderId;

    for (const part of parts) {
      parentId = this.getOrCreateFolder(part, parentId);
    }

    return parentId;
  }

  // -------------------------------------------------------------------------
  // Directory Indexing Orchestration
  // -------------------------------------------------------------------------

  /**
   * Main entry point for indexing a directory of media files.
   *
   * 1. Delete orphans
   * 2. Scan paths and files
   * 3. Process file groups with p-limit concurrency control
   * 4. Queue hash and face matching
   * 5. Emit progress notifications
   */
  async addDirectory(options: AddDirectoryOptions): Promise<void> {
    const {
      directory,
      fileFilter,
      concurrency = 4,
      hostId: providedHostId,
    } = options;

    const hostId = providedHostId ?? getOrCreateHost(this.db);

    this.logger.info({ directory, concurrency }, 'Starting directory indexing');

    // Delete orphans before indexing
    await this.deleteOrphans();

    // Scan paths
    this.notifications.notify('progress', 'fileIndex', { phase: 'scanning', directory });
    const pathRecords = await this.addPaths(directory, hostId, fileFilter);
    this.logger.info({ pathCount: pathRecords.length }, 'Paths registered');

    // Scan files
    this.notifications.notify('progress', 'fileIndex', { phase: 'registering_files' });
    const fileGroups = await this.addFiles(pathRecords, fileFilter);
    this.logger.info({ groupCount: fileGroups.length }, 'File groups registered');

    // Create root folder
    const rootFolderName = basename(directory);
    const rootFolderId = this.getOrCreateFolder(rootFolderName, null);

    // Process file groups with concurrency control
    const limit = pLimit(concurrency);
    const total = fileGroups.length;
    let processed = 0;

    const matchPromises: Promise<void>[] = [];

    const tasks = fileGroups.map(({ group, fileIds }, index) =>
      limit(async () => {
        const folderId = this.buildFolderHierarchy(
          group.directory,
          directory,
          rootFolderId,
        );

        const result = await this.createMediaItem(group, fileIds, folderId, index);

        if (result) {
          // Collect face match promises
          matchPromises.push(...result.faceMatchPromises);

          // Queue hash matching
          const item = this.db
            .select({ hash: schema.mediaItem.hash })
            .from(schema.mediaItem)
            .where(eq(schema.mediaItem.id, result.mediaItemId))
            .get();

          if (item?.hash) {
            const promise = this.hashMatcher
              .matchHash(result.mediaItemId, item.hash)
              .catch((err: unknown) => {
                this.logger.warn({ mediaItemId: result.mediaItemId, err }, 'Hash matching failed');
              })
              .then(() => {});
            matchPromises.push(promise);
          }
        }

        processed++;
        this.notifications.notify('progress', 'fileIndex', {
          phase: 'indexing',
          processed,
          total,
          file: group.primary.path,
        });
      }),
    );

    await Promise.all(tasks);

    // Wait for all matching operations (hash + face) to complete
    await Promise.all(matchPromises);

    this.hashMatcher.clearCache();
    this.faceMatcher.clearCache();

    this.logger.info({ directory, processed: total }, 'Directory indexing complete');
    this.notifications.notify('progress', 'fileIndex', {
      phase: 'complete',
      processed: total,
      total,
    });
  }

  // -------------------------------------------------------------------------
  // Orphan Cleanup
  // -------------------------------------------------------------------------

  /**
   * Check all DB file records against disk and remove entries whose files
   * no longer exist. Cascades to media items, thumbnails, paths, and
   * empty folders.
   */
  async deleteOrphans(): Promise<{
    files: number;
    mediaItems: number;
    paths: number;
    folders: number;
    thumbnails: number;
  }> {
    let deletedFiles = 0;
    let deletedMediaItems = 0;
    let deletedPaths = 0;
    let deletedFolders = 0;
    let deletedThumbnails = 0;

    // 1. Find and delete file records whose files no longer exist on disk
    const allFiles = this.db
      .select({
        id: schema.file.id,
        name: schema.file.name,
        extension: schema.file.extension,
        pathId: schema.file.pathId,
      })
      .from(schema.file)
      .all();

    const pathCache = new Map<number, string>();
    const orphanFileIds: number[] = [];

    for (const file of allFiles) {
      let dir = pathCache.get(file.pathId);
      if (dir === undefined) {
        const pathRecord = this.db
          .select({ dir: schema.path.dir })
          .from(schema.path)
          .where(eq(schema.path.id, file.pathId))
          .get();
        dir = pathRecord?.dir ?? '';
        pathCache.set(file.pathId, dir);
      }

      const ext = file.extension ? `.${file.extension}` : '';
      const filePath = join(dir, `${file.name}${ext}`);

      if (!existsSync(filePath)) {
        orphanFileIds.push(file.id);
      }
    }

    if (orphanFileIds.length > 0) {
      // Delete thumbnails for orphaned files before removing records
      for (const fileId of orphanFileIds) {
        const fileRecord = this.db
          .select({
            name: schema.file.name,
            pathId: schema.file.pathId,
          })
          .from(schema.file)
          .where(eq(schema.file.id, fileId))
          .get();

        if (fileRecord) {
          const dir = pathCache.get(fileRecord.pathId) ?? '';
          const thumbDir = getThumbnailDirectory(join(dir, fileRecord.name));
          try {
            const count = await deleteThumbnails(dirname(join(dir, fileRecord.name)));
            deletedThumbnails += count;
          } catch {
            // Thumbnail directory may not exist
          }
        }
      }

      // Batch delete in chunks to avoid SQLite variable limits
      const CHUNK_SIZE = 100;
      for (let i = 0; i < orphanFileIds.length; i += CHUNK_SIZE) {
        const chunk = orphanFileIds.slice(i, i + CHUNK_SIZE);
        this.db
          .delete(schema.file)
          .where(inArray(schema.file.id, chunk))
          .run();
      }
      deletedFiles = orphanFileIds.length;
    }

    // 2. Delete media items left with no files
    const allMediaItems = this.db
      .select({ id: schema.mediaItem.id })
      .from(schema.mediaItem)
      .all();

    for (const item of allMediaItems) {
      const hasFiles = this.db
        .select({ fileId: schema.mediaItemFile.fileId })
        .from(schema.mediaItemFile)
        .where(eq(schema.mediaItemFile.mediaItemId, item.id))
        .limit(1)
        .get();

      if (!hasFiles) {
        this.db
          .delete(schema.mediaItem)
          .where(eq(schema.mediaItem.id, item.id))
          .run();
        deletedMediaItems++;
      }
    }

    // 3. Delete paths with no files
    const allPaths = this.db
      .select({ id: schema.path.id })
      .from(schema.path)
      .all();

    for (const pathRecord of allPaths) {
      const hasFiles = this.db
        .select({ id: schema.file.id })
        .from(schema.file)
        .where(eq(schema.file.pathId, pathRecord.id))
        .limit(1)
        .get();

      if (!hasFiles) {
        this.db
          .delete(schema.path)
          .where(eq(schema.path.id, pathRecord.id))
          .run();
        deletedPaths++;
      }
    }

    // 4. Delete empty folders (recursive, bottom-up)
    deletedFolders = this.deleteEmptyFolders();

    if (deletedFiles > 0 || deletedMediaItems > 0) {
      this.logger.info(
        { deletedFiles, deletedMediaItems, deletedPaths, deletedFolders, deletedThumbnails },
        'Orphan cleanup complete',
      );
    }

    return {
      files: deletedFiles,
      mediaItems: deletedMediaItems,
      paths: deletedPaths,
      folders: deletedFolders,
      thumbnails: deletedThumbnails,
    };
  }

  /**
   * Recursively delete folders that have no entries and no children.
   * Runs bottom-up to handle nested empty folders.
   */
  private deleteEmptyFolders(): number {
    let totalDeleted = 0;
    let deletedThisPass: number;

    do {
      deletedThisPass = 0;

      const allFolders = this.db
        .select({ id: schema.folder.id })
        .from(schema.folder)
        .all();

      for (const folder of allFolders) {
        const hasEntries = this.db
          .select({ id: schema.folderEntry.id })
          .from(schema.folderEntry)
          .where(eq(schema.folderEntry.folderId, folder.id))
          .limit(1)
          .get();

        if (hasEntries) continue;

        const hasChildren = this.db
          .select({ id: schema.folder.id })
          .from(schema.folder)
          .where(eq(schema.folder.parentId, folder.id))
          .limit(1)
          .get();

        if (hasChildren) continue;

        this.db
          .delete(schema.folder)
          .where(eq(schema.folder.id, folder.id))
          .run();
        deletedThisPass++;
      }

      totalDeleted += deletedThisPass;
    } while (deletedThisPass > 0);

    return totalDeleted;
  }
}
