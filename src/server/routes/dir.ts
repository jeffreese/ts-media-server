import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { hasAdminAccess, assertSafePath } from './shared.js';

const dirQuerySchema = z.object({
  path: z.string().min(1),
});

const downloadQuerySchema = z.object({
  path: z.string().min(1),
});

export interface DirPluginOptions {
  db: Database.Database;
}

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

/**
 * File browser routes for server-side filesystem access (SysAdmin only).
 *
 * - `GET /dir` — list files and directories at a given path
 * - `POST /dir/upload` — upload files to a directory on the server
 * - `GET /dir/download` — download a file from the server
 */
export const dirPlugin = fp<DirPluginOptions>(
  async function dirPlugin(
    app: FastifyInstance,
    opts: DirPluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    function requireAdmin(userId: number | undefined): { error: string; code: number } | null {
      if (userId === undefined) {
        return { code: 401, error: 'Unauthorized' };
      }
      if (!hasAdminAccess(db, userId)) {
        return { code: 403, error: 'SysAdmin access required' };
      }
      return null;
    }

    app.get('/dir', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = dirQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Query parameter "path" is required' });
      }

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
      const results: DirEntry[] = [];

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
          });
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

    app.post('/dir/upload', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(request.userId);
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

    app.get('/dir/download', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const authError = requireAdmin(request.userId);
      if (authError) return reply.code(authError.code).send({ error: authError.error });

      const parsed = downloadQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Query parameter "path" is required' });
      }

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
  },
  { name: 'dir-routes', dependencies: ['auth'] },
);
