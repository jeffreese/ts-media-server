import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { platform } from 'node:os';

const BUSY_TIMEOUT_MS = 5000;

/**
 * Common SpatiaLite extension paths by platform. The extension loader tries
 * each path in order and uses the first one that exists on disk.
 */
const SPATIALITE_SEARCH_PATHS: Record<string, string[]> = {
  darwin: [
    '/opt/homebrew/lib/mod_spatialite.dylib',
    '/usr/local/lib/mod_spatialite.dylib',
  ],
  linux: [
    '/usr/lib/x86_64-linux-gnu/mod_spatialite.so',
    '/usr/lib/aarch64-linux-gnu/mod_spatialite.so',
    '/usr/lib/mod_spatialite.so',
    '/usr/local/lib/mod_spatialite.so',
  ],
  win32: [
    'C:\\spatialite\\mod_spatialite.dll',
  ],
};

export interface DatabaseClientOptions {
  /** Path to the SQLite database file. Use ':memory:' for in-memory databases. */
  path: string;
  /** Explicit path to the mod_spatialite extension. Overrides auto-detection. */
  spatialitePath?: string;
  /** Whether to load SpatiaLite. Defaults to true. */
  enableSpatialite?: boolean;
}

export interface DatabaseClient {
  db: Database.Database;
  spatialiteLoaded: boolean;
}

/**
 * Auto-detect the SpatiaLite extension path by checking common install
 * locations for the current platform.
 */
export function findSpatialiteExtension(): string | undefined {
  const paths = SPATIALITE_SEARCH_PATHS[platform()] ?? [];
  return paths.find((p) => existsSync(p));
}

/**
 * Load the SpatiaLite extension into an open database connection.
 * Returns true if the extension was loaded successfully.
 */
function loadSpatialite(db: Database.Database, extensionPath: string): boolean {
  try {
    db.loadExtension(extensionPath);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load SpatiaLite from ${extensionPath}: ${message}`);
    return false;
  }
}

/**
 * Initialize SpatiaLite metadata tables. Required once per database to enable
 * geometry column registration and spatial indexes.
 */
function initSpatialMetadata(db: Database.Database): void {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='geometry_columns'",
  ).get() as { name: string } | undefined;

  if (!row) {
    db.exec('SELECT InitSpatialMetaData(1)');
  }
}

/**
 * Open a SQLite database with WAL mode, busy_timeout, and optional SpatiaLite
 * extension loading.
 */
export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  const { path, spatialitePath, enableSpatialite = true } = options;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.pragma('foreign_keys = ON');

  let spatialiteLoaded = false;

  if (enableSpatialite) {
    const extPath = spatialitePath ?? findSpatialiteExtension();
    if (extPath) {
      spatialiteLoaded = loadSpatialite(db, extPath);
      if (spatialiteLoaded) {
        initSpatialMetadata(db);
      }
    }
  }

  return { db, spatialiteLoaded };
}
