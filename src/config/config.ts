import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { configSchema, type Config } from './schema.js';

interface LoadConfigOptions {
  configPath?: string;
}

/**
 * Reads the JSON config file at `filePath`. Returns an empty object if the
 * file doesn't exist; throws on malformed JSON or read errors.
 */
async function readConfigFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

const ENV_MAP: Record<string, (value: string, config: Record<string, unknown>) => void> = {
  PORT: (v, c) => { c.port = Number(v); },
  WEB_DIR: (v, c) => { c.webDir = v; },
  LOG_DIR: (v, c) => { c.logDir = v; },
  TEMP_DIR: (v, c) => { c.temp = v; },
  DATABASE_PATH: (v, c) => {
    const db = (c.database ?? {}) as Record<string, unknown>;
    db.path = v;
    c.database = db;
  },
  CONCURRENCY: (v, c) => { c.concurrency = Number(v); },
  JWT_SECRET: (v, c) => {
    const jwt = (c.jwt ?? {}) as Record<string, unknown>;
    jwt.secret = v;
    c.jwt = jwt;
  },
  JWT_EXPIRES_IN: (v, c) => {
    const jwt = (c.jwt ?? {}) as Record<string, unknown>;
    jwt.expiresIn = v;
    c.jwt = jwt;
  },
};

function applyEnvOverrides(config: Record<string, unknown>, env: Record<string, string | undefined>): void {
  for (const [envKey, apply] of Object.entries(ENV_MAP)) {
    const value = env[envKey];
    if (value !== undefined && value !== '') {
      apply(value, config);
    }
  }
}

/**
 * Resolve path-valued config fields relative to the config file's directory,
 * so that `"database": { "path": "data/database.sqlite" }` resolves relative
 * to where the config file lives, not the process cwd.
 */
function resolvePaths(config: Record<string, unknown>, baseDir: string): void {
  const pathKeys = ['webDir', 'logDir', 'temp'] as const;
  for (const key of pathKeys) {
    const value = config[key];
    if (typeof value === 'string' && !isAbsolute(value)) {
      config[key] = resolve(baseDir, value);
    }
  }

  const db = config.database as Record<string, unknown> | undefined;
  if (db && typeof db.path === 'string' && !isAbsolute(db.path)) {
    db.path = resolve(baseDir, db.path);
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<Config> {
  const configPath = resolve(options.configPath ?? 'config.json');
  const fileConfig = await readConfigFile(configPath);

  applyEnvOverrides(fileConfig, process.env);
  resolvePaths(fileConfig, resolve(configPath, '..'));

  return configSchema.parse(fileConfig);
}
