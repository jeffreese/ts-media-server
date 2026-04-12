import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DatabaseClient } from './client.js';
import * as schema from './schema.js';

const DRIZZLE_DIR = resolve(fileURLToPath(import.meta.url), '../../../drizzle');
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
