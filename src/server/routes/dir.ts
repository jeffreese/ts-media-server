import { createReadStream } from 'node:fs';
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, basename, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import { SYSADMIN_KEY, ADMIN_ACCESS_LEVEL } from '../../db/constants.js';

const dirQuerySchema = z.object({
  path: z.string().min(1),
});

const downloadQuerySchema = z.object({
  path: z.string().min(1),
});

export interface DirPluginOptions {
  db: Database.Database;
}

function hasAdminAccess(
  db: BetterSQLite3Database<typeof schema>,
  userId: number,
): boolean {
  const row = db
    .select({ level: schema.userAccess.level })
    .from(schema.userAccess)
    .innerJoin(schema.component, eq(schema.component.id, schema.userAccess.componentId))
    .where(
      and(
        eq(schema.userAccess.userId, userId),
        eq(schema.component.key, SYSADMIN_KEY),
      ),
    )
    .get();

  return (row?.level ?? 0) >= ADMIN_ACCESS_LEVEL;
}

function assertSafePath(path: string): void {
  if (!resolve(path).startsWith('/')) {
    throw new Error(`Path must be absolute: "${path}"`);
  }
  if (path.includes('..')) {
    throw new Error(`Path must not contain traversal segments: "${path}"`);
  }
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

          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }

          const destPath = join(targetDir, filename);
          await writeFile(destPath, Buffer.concat(chunks));
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
      return reply
        .type('application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', fileStat.size)
        .send(createReadStream(filePath));
    });
  },
  { name: 'dir-routes', dependencies: ['auth'] },
);
