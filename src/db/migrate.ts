import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DatabaseClient } from './client.js';
import * as schema from './schema.js';

/**
 * Locate the project root by walking up from this file until we find the
 * `drizzle/` directory. Works both in the source layout (src/db/migrate.ts)
 * and the bundled layout (dist/index.js).
 */
function findProjectRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = dirname(thisFile);
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'drizzle', 'migrations', 'meta', '_journal.json');
    try {
      readFileSync(candidate);
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(
    `Can't find drizzle/migrations — looked upward from ${dirname(thisFile)}`,
  );
}

const PROJECT_ROOT = findProjectRoot();
const DRIZZLE_DIR = resolve(PROJECT_ROOT, 'drizzle');
const MIGRATIONS_DIR = resolve(DRIZZLE_DIR, 'migrations');
const SPATIALITE_SQL_PATH = resolve(DRIZZLE_DIR, 'spatialite.sql');

export interface MigrateOptions {
  migrationsFolder?: string;
  spatialiteSqlPath?: string;
}

/**
 * Run all pending Drizzle migrations, then apply SpatiaLite geometry columns
 * if the extension is loaded.
 *
 * SpatiaLite's `AddGeometryColumn` and `CreateSpatialIndex` are inherently
 * idempotent — they print a warning on duplicates but don't throw.
 */
export function runMigrations(
  client: DatabaseClient,
  options: MigrateOptions = {},
): void {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_DIR;
  const db = drizzle(client.db, { schema });

  drizzleMigrate(db, { migrationsFolder });

  if (client.spatialiteLoaded) {
    applySpatialiteSetup(client, options.spatialiteSqlPath ?? SPATIALITE_SQL_PATH);
  }
}

function applySpatialiteSetup(client: DatabaseClient, sqlPath: string): void {
  const sql = readFileSync(sqlPath, 'utf-8');
  const statements = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));

  for (const stmt of statements) {
    client.db.exec(stmt);
  }
}
