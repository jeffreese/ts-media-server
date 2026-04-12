import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';

const querySchema = z.object({
  recursive: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export interface IndexPluginOptions {
  db: Database.Database;
}

interface FolderResult {
  id: number;
  name: string;
  description: string | null;
  parentId: number | null;
  info: unknown;
}

interface MediaItemResult {
  id: number;
  name: string | null;
  description: string | null;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  info: unknown;
  folderEntryIndex: number | null;
}

/**
 * Resolve a folder by walking the path segments from a root folder.
 * Returns undefined if any segment is not found.
 */
function resolveFolderByPath(
  db: BetterSQLite3Database<typeof schema>,
  pathSegments: string[],
): FolderResult | undefined {
  let parentId: number | null = null;

  for (const segment of pathSegments) {
    const condition: SQL | undefined =
      parentId === null
        ? and(eq(schema.folder.name, segment), isNull(schema.folder.parentId))
        : and(
            eq(schema.folder.name, segment),
            eq(schema.folder.parentId, parentId),
          );

    const row: { id: number } | undefined = db
      .select({ id: schema.folder.id })
      .from(schema.folder)
      .where(condition)
      .get();

    if (!row) return undefined;
    parentId = row.id;
  }

  if (parentId === null) return undefined;

  const result: FolderResult | undefined = db
    .select({
      id: schema.folder.id,
      name: schema.folder.name,
      description: schema.folder.description,
      parentId: schema.folder.parentId,
      info: schema.folder.info,
    })
    .from(schema.folder)
    .where(eq(schema.folder.id, parentId))
    .get() ?? undefined;

  return result;
}

function getChildFolders(
  db: BetterSQLite3Database<typeof schema>,
  parentId: number | null,
): FolderResult[] {
  const condition: SQL = parentId === null
    ? isNull(schema.folder.parentId)
    : eq(schema.folder.parentId, parentId);

  return db
    .select({
      id: schema.folder.id,
      name: schema.folder.name,
      description: schema.folder.description,
      parentId: schema.folder.parentId,
      info: schema.folder.info,
    })
    .from(schema.folder)
    .where(condition)
    .all();
}

function getMediaItems(
  db: BetterSQLite3Database<typeof schema>,
  folderId: number,
): MediaItemResult[] {
  return db
    .select({
      id: schema.mediaItem.id,
      name: schema.mediaItem.name,
      description: schema.mediaItem.description,
      type: schema.mediaItem.type,
      startDate: schema.mediaItem.startDate,
      endDate: schema.mediaItem.endDate,
      info: schema.mediaItem.info,
      folderEntryIndex: schema.folderEntry.index,
    })
    .from(schema.folderEntry)
    .innerJoin(schema.mediaItem, eq(schema.mediaItem.id, schema.folderEntry.itemId))
    .where(eq(schema.folderEntry.folderId, folderId))
    .orderBy(schema.folderEntry.index)
    .all();
}

/**
 * Recursively collect all folders and media items below a given folder.
 */
function collectRecursive(
  db: BetterSQLite3Database<typeof schema>,
  folderId: number,
  folders: FolderResult[],
  items: MediaItemResult[],
): void {
  const children = getChildFolders(db, folderId);
  folders.push(...children);
  items.push(...getMediaItems(db, folderId));

  for (const child of children) {
    collectRecursive(db, child.id, folders, items);
  }
}

/**
 * Folder browsing API: `GET /index/*` navigates the virtual folder hierarchy.
 *
 * - `GET /index` — list root-level folders and items
 * - `GET /index/Photos/2024` — list contents of the `Photos > 2024` folder
 * - `?recursive=true` — include all descendants, not just direct children
 * - `?offset=0&limit=50` — paginate the combined results
 */
export const indexPlugin = fp<IndexPluginOptions>(
  async function indexPlugin(
    app: FastifyInstance,
    opts: IndexPluginOptions,
  ): Promise<void> {
    const db = drizzle(opts.db, { schema });

    app.get('/index', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      return handleFolderBrowse(db, null, [], queryParsed.data, reply);
    });

    app.get('/index/*', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const queryParsed = querySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters' });
      }

      const wildcard = (request.params as Record<string, string>)['*'] ?? '';
      const segments = wildcard.split('/').filter(Boolean);

      if (segments.length === 0) {
        return handleFolderBrowse(db, null, [], queryParsed.data, reply);
      }

      const folder = resolveFolderByPath(db, segments);
      if (!folder) {
        return reply.code(404).send({ error: 'Folder not found' });
      }

      return handleFolderBrowse(db, folder.id, segments, queryParsed.data, reply);
    });
  },
  { name: 'index-routes', dependencies: ['auth'] },
);

function handleFolderBrowse(
  db: BetterSQLite3Database<typeof schema>,
  folderId: number | null,
  pathSegments: string[],
  query: { recursive: boolean; offset: number; limit: number },
  reply: FastifyReply,
) {
  const { recursive, offset, limit } = query;

  let folders: FolderResult[];
  let items: MediaItemResult[];

  if (recursive && folderId !== null) {
    folders = [];
    items = [...getMediaItems(db, folderId)];
    collectRecursive(db, folderId, folders, items);
  } else if (recursive && folderId === null) {
    const roots = getChildFolders(db, null);
    folders = [...roots];
    items = [];
    for (const root of roots) {
      items.push(...getMediaItems(db, root.id));
      collectRecursive(db, root.id, folders, items);
    }
  } else {
    folders = getChildFolders(db, folderId);
    items = folderId !== null ? getMediaItems(db, folderId) : [];
  }

  const allEntries = [
    ...folders.map((f) => ({ kind: 'folder' as const, ...f })),
    ...items.map((i) => ({ kind: 'item' as const, ...i })),
  ];

  const total = allEntries.length;
  const paged = allEntries.slice(offset, offset + limit);

  return reply.send({
    path: pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/',
    folderId,
    folders: paged.filter((e): e is typeof e & { kind: 'folder' } => e.kind === 'folder')
      .map(({ kind: _kind, ...rest }) => rest),
    items: paged.filter((e): e is typeof e & { kind: 'item' } => e.kind === 'item')
      .map(({ kind: _kind, ...rest }) => rest),
    offset,
    limit,
    total,
  });
}
