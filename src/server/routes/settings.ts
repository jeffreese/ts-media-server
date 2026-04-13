import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { hasAdminAccess, assertSafePath } from './shared.js';

const paramsSchema = z.object({
  key: z.string().min(1),
});

const bodySchema = z.object({
  value: z.string(),
});

const ALLOWED_FFMPEG_BASENAMES = new Set(['ffmpeg', 'ffprobe', 'ffmpeg.exe', 'ffprobe.exe']);

export interface SettingsPluginOptions {
  db: Database.Database;
}

function execFileAsync(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function validateFfmpegPath(path: string): Promise<void> {
  assertSafePath(path);

  const name = basename(path);
  if (!ALLOWED_FFMPEG_BASENAMES.has(name)) {
    throw new Error(`Expected an ffmpeg or ffprobe binary, got "${name}"`);
  }

  try {
    await execFileAsync(path, ['-version']);
  } catch {
    throw new Error(`FFmpeg not found at "${path}". Ensure FFmpeg is installed and the path is correct.`);
  }
}

async function validateOnnxModelPath(path: string): Promise<void> {
  assertSafePath(path);

  if (extname(path).toLowerCase() !== '.onnx') {
    throw new Error(`ONNX model path must have a .onnx extension: "${path}"`);
  }

  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`ONNX model file not found or not readable: "${path}"`);
  }
}

const VALIDATED_KEYS: Record<string, (value: string) => Promise<void>> = {
  ffmpegPath: validateFfmpegPath,
  ffprobePath: validateFfmpegPath,
  faceDetectionModelPath: validateOnnxModelPath,
  faceRecognitionModelPath: validateOnnxModelPath,
};

/**
 * Settings API routes.
 *
 * - `GET /setting/:key` — retrieve a setting value (plain text)
 * - `POST /setting/:key` — create or update a setting (admin only)
 *
 * Settings cannot be deleted. Certain keys trigger validation before saving
 * (FFmpeg paths are tested with `-version`, ONNX model paths are checked
 * for existence and correct extension).
 */
export const settingsPlugin = fp<SettingsPluginOptions>(
  async function settingsPlugin(
    app: FastifyInstance,
    opts: SettingsPluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    app.get('/setting/:key', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid key parameter' });
      }
      const { key } = parsed.data;

      const row = db
        .select()
        .from(schema.setting)
        .where(eq(schema.setting.key, key))
        .get();

      if (!row) {
        return reply.code(404).send({ error: `Setting "${key}" not found` });
      }

      return reply.type('text/plain').send(row.value ?? '');
    });

    app.post('/setting/:key', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const userId = request.userId;
      if (userId === undefined) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!hasAdminAccess(db, userId)) {
        return reply.code(403).send({ error: 'SysAdmin access required' });
      }

      const paramsParsed = paramsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid key parameter' });
      }
      const { key } = paramsParsed.data;

      const bodyParsed = bodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: 'Request body must include a "value" string field' });
      }
      const { value } = bodyParsed.data;

      const validator = VALIDATED_KEYS[key];
      if (validator) {
        try {
          await validator(value);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Validation failed';
          return reply.code(422).send({ error: message });
        }
      }

      db.insert(schema.setting)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
        .run();

      return reply.type('text/plain').send(value);
    });

    app.delete('/setting/:key', {
      preHandler: [app.authenticate],
    }, async (_request, reply) => {
      return reply.code(405).send({ error: 'Settings cannot be deleted' });
    });
  },
  { name: 'settings', dependencies: ['auth'] },
);
