import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { hasAdminAccess, assertSafePath } from './shared.js';

export interface AdminPluginOptions {
  db: Database.Database;
  onIndexDirectory?: (directory: string, concurrency: number) => void;
}

type Db = BetterSQLite3Database<typeof schema>;

function requireAdmin(
  db: Db,
  userId: number | undefined,
): { error: string; code: number } | null {
  if (userId === undefined) return { code: 401, error: 'Unauthorized' };
  if (!hasAdminAccess(db, userId)) return { code: 403, error: 'SysAdmin access required' };
  return null;
}

const settingKeySchema = z.object({
  key: z.string().min(1),
});

const settingBodySchema = z.object({
  value: z.string(),
});

const dirQuerySchema = z.object({
  path: z.string().min(1),
});

const indexBodySchema = z.object({
  directory: z.string().min(1),
  concurrency: z.number().int().positive().optional(),
});

const downloadQuerySchema = z.object({
  path: z.string().min(1),
});

/**
 * Admin panel API routes. All routes require SysAdmin access.
 *
 * - `GET /admin/stats` — server overview (path count, file count, media count, etc.)
 * - `GET /admin/paths` — list all indexed paths
 * - `GET /admin/settings` — list all settings as key-value pairs
 * - `GET /admin/settings/:key` — get a single setting
 * - `POST /admin/settings/:key` — update a setting
 * - `GET /admin/dir` — browse server filesystem
 * - `POST /admin/dir/upload` — upload files to server
 * - `GET /admin/dir/download` — download a file from server
 * - `POST /admin/index` — trigger directory indexing
 */
export const adminPlugin = fp<AdminPluginOptions>(
  async function adminPlugin(
    app: FastifyInstance,
    opts: AdminPluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });

    // -----------------------------------------------------------------------
    // GET /admin/stats — server overview
    // -----------------------------------------------------------------------

    app.get('/admin/stats', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const pathCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.path).get()?.count ?? 0,
      );
      const fileCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.file).get()?.count ?? 0,
      );
      const mediaItemCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.mediaItem).get()?.count ?? 0,
      );
      const featureCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.feature).get()?.count ?? 0,
      );
      const matchCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.mediaMatch).get()?.count ?? 0,
      );
      const personCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.person).get()?.count ?? 0,
      );
      const placeCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.place).get()?.count ?? 0,
      );
      const keywordCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.keyword).get()?.count ?? 0,
      );
      const userCount = Number(
        db.select({ count: sql<number>`count(*)` }).from(schema.user).get()?.count ?? 0,
      );

      const imageCount = Number(
        db.select({ count: sql<number>`count(*)` })
          .from(schema.mediaItem)
          .where(eq(schema.mediaItem.type, 'image'))
          .get()?.count ?? 0,
      );
      const videoCount = Number(
        db.select({ count: sql<number>`count(*)` })
          .from(schema.mediaItem)
          .where(eq(schema.mediaItem.type, 'video'))
          .get()?.count ?? 0,
      );

      return reply.send({
        paths: pathCount,
        files: fileCount,
        mediaItems: mediaItemCount,
        images: imageCount,
        videos: videoCount,
        features: featureCount,
        matches: matchCount,
        people: personCount,
        places: placeCount,
        keywords: keywordCount,
        users: userCount,
      });
    });

    // -----------------------------------------------------------------------
    // GET /admin/paths — list indexed directory paths
    // -----------------------------------------------------------------------

    app.get('/admin/paths', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const rows = db
        .select({
          id: schema.path.id,
          dir: schema.path.dir,
          fileCount: sql<number>`count(${schema.file.id})`,
        })
        .from(schema.path)
        .leftJoin(schema.file, eq(schema.file.pathId, schema.path.id))
        .groupBy(schema.path.id, schema.path.dir)
        .orderBy(schema.path.dir)
        .all();

      return reply.send({ paths: rows });
    });

    // -----------------------------------------------------------------------
    // GET /admin/settings — list all settings
    // -----------------------------------------------------------------------

    app.get('/admin/settings', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const rows = db.select().from(schema.setting).orderBy(schema.setting.key).all();
      return reply.send({ settings: rows });
    });

    // -----------------------------------------------------------------------
    // GET /admin/settings/:key — get a single setting
    // -----------------------------------------------------------------------

    app.get('/admin/settings/:key', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = settingKeySchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid key parameter' });

      const row = db
        .select()
        .from(schema.setting)
        .where(eq(schema.setting.key, parsed.data.key))
        .get();

      if (!row) return reply.code(404).send({ error: `Setting "${parsed.data.key}" not found` });
      return reply.send(row);
    });

    // -----------------------------------------------------------------------
    // POST /admin/settings/:key — update a setting
    // -----------------------------------------------------------------------

    app.post('/admin/settings/:key', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const paramsParsed = settingKeySchema.safeParse(request.params);
      if (!paramsParsed.success) return reply.code(400).send({ error: 'Invalid key parameter' });

      const bodyParsed = settingBodySchema.safeParse(request.body);
      if (!bodyParsed.success) return reply.code(400).send({ error: 'Request body must include a "value" string' });

      const { key } = paramsParsed.data;
      const { value } = bodyParsed.data;

      db.insert(schema.setting)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
        .run();

      return reply.send({ key, value });
    });

    // -----------------------------------------------------------------------
    // GET /admin/dir — browse server filesystem
    // -----------------------------------------------------------------------

    app.get('/admin/dir', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = dirQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Query parameter "path" is required' });

      const dirPath = parsed.data.path;
      try {
        assertSafePath(dirPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid path';
        return reply.code(400).send({ error: message });
      }

      let dirStat;
      try {
        dirStat = await stat(dirPath);
      } catch {
        return reply.code(404).send({ error: `Path not found: "${dirPath}"` });
      }

      if (!dirStat.isDirectory()) {
        return reply.code(400).send({ error: `Path is not a directory: "${dirPath}"` });
      }

      const entries = await readdir(dirPath, { withFileTypes: true });
      const results: {
        name: string;
        path: string;
        type: 'file' | 'directory';
        size?: number;
        modified?: string;
        extension?: string;
      }[] = [];

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          results.push({ name: entry.name, path: fullPath, type: 'directory' });
        } else if (entry.isFile()) {
          let fileStat;
          try {
            fileStat = await stat(fullPath);
          } catch {
            continue;
          }
          const ext = extname(entry.name).replace(/^\./, '');
          results.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            size: fileStat.size,
            modified: fileStat.mtime.toISOString(),
            ...(ext ? { extension: ext } : {}),
          });
        }
      }

      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return reply.send(results);
    });

    // -----------------------------------------------------------------------
    // POST /admin/dir/upload — upload files to server
    // -----------------------------------------------------------------------

    app.post('/admin/dir/upload', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parts = request.parts();
      let targetDir: string | undefined;
      const savedFiles: string[] = [];

      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'path' && typeof part.value === 'string') {
            targetDir = part.value;
          }
          continue;
        }

        if (part.type === 'file') {
          if (!targetDir) {
            return reply.code(400).send({ error: 'The "path" field must appear before file parts' });
          }

          try {
            assertSafePath(targetDir);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid path';
            return reply.code(400).send({ error: message });
          }

          const filename = basename(part.filename ?? 'upload');
          if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
            return reply.code(400).send({ error: `Invalid filename: "${filename}"` });
          }

          await mkdir(targetDir, { recursive: true });
          const destPath = join(targetDir, filename);
          await pipeline(part.file, createWriteStream(destPath));
          savedFiles.push(destPath);
        }
      }

      if (!targetDir) {
        return reply.code(400).send({ error: 'Missing "path" field in multipart form' });
      }

      return reply.send({ uploaded: savedFiles });
    });

    // -----------------------------------------------------------------------
    // GET /admin/dir/download — download a file from server
    // -----------------------------------------------------------------------

    app.get('/admin/dir/download', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = downloadQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Query parameter "path" is required' });

      const filePath = parsed.data.path;
      try {
        assertSafePath(filePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid path';
        return reply.code(400).send({ error: message });
      }

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        return reply.code(404).send({ error: `File not found: "${filePath}"` });
      }

      if (!fileStat.isFile()) {
        return reply.code(400).send({ error: `Path is not a file: "${filePath}"` });
      }

      const filename = basename(filePath);
      const encoded = encodeURIComponent(filename);
      return reply
        .type('application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`)
        .header('Content-Length', fileStat.size)
        .send(createReadStream(filePath));
    });

    // -----------------------------------------------------------------------
    // POST /admin/index — trigger directory indexing
    // -----------------------------------------------------------------------

    app.post('/admin/index', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = indexBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Request body must include "directory" string' });

      const directory = resolve(parsed.data.directory);
      const concurrency = parsed.data.concurrency ?? 4;

      try {
        assertSafePath(directory);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid path';
        return reply.code(400).send({ error: message });
      }

      let dirStat;
      try {
        dirStat = await stat(directory);
      } catch {
        return reply.code(404).send({ error: `Directory not found: "${directory}"` });
      }
      if (!dirStat.isDirectory()) {
        return reply.code(400).send({ error: `Path is not a directory: "${directory}"` });
      }

      if (!opts.onIndexDirectory) {
        return reply.code(501).send({ error: 'Indexing not available in this server configuration' });
      }

      opts.onIndexDirectory(directory, concurrency);

      return reply.send({ status: 'started', directory, concurrency });
    });

    // -----------------------------------------------------------------------
    // POST /admin/reindex — re-index existing paths
    // -----------------------------------------------------------------------

    app.post('/admin/reindex', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(db, request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      if (!opts.onIndexDirectory) {
        return reply.code(501).send({ error: 'Indexing not available in this server configuration' });
      }

      const paths = db.select({ dir: schema.path.dir }).from(schema.path).all();
      if (paths.length === 0) {
        return reply.send({ status: 'no_paths', message: 'No indexed paths to re-index' });
      }

      const parentDirs = new Set<string>();
      for (const row of paths) {
        const parts = row.dir.split('/');
        parts.pop();
        const parent = parts.join('/') || '/';
        parentDirs.add(parent);
      }

      const uniqueDirs = [...parentDirs].sort();
      for (const dir of uniqueDirs) {
        let dirStat;
        try {
          dirStat = await stat(dir);
        } catch {
          continue;
        }
        if (dirStat.isDirectory()) {
          opts.onIndexDirectory(dir, 4);
        }
      }

      return reply.send({ status: 'started', directories: uniqueDirs });
    });
  },
  { name: 'admin-routes', dependencies: ['auth'] },
);
