import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hash, compare } from 'bcrypt';
import { eq, and } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../db/schema.js';

const BCRYPT_ROUNDS = 12;
const AUTH_SERVICE = 'database';
const AUTH_KEY = 'password';

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

interface JwtPayload {
  userId: number;
  iat?: number;
  exp?: number;
}

export interface AuthPluginOptions {
  db: Database.Database;
}

/**
 * Look up the `auth_status` setting. Returns `"disabled"` for fresh installs
 * where no credentials have been configured yet.
 */
function getAuthStatus(db: BetterSQLite3Database<typeof schema>): string {
  const row = db
    .select()
    .from(schema.setting)
    .where(eq(schema.setting.key, 'auth_status'))
    .get();
  return row?.value ?? 'disabled';
}

function getDefaultUserId(db: BetterSQLite3Database<typeof schema>): number | undefined {
  const row = db.select().from(schema.user).limit(1).get();
  return row?.id;
}

/**
 * Find a user by matching their preferred person name (case-insensitive).
 */
function findUserByUsername(
  db: BetterSQLite3Database<typeof schema>,
  username: string,
): typeof schema.user.$inferSelect | undefined {
  const rows = db
    .select({
      userId: schema.user.id,
      personId: schema.user.personId,
      status: schema.user.status,
      name: schema.personName.name,
    })
    .from(schema.user)
    .innerJoin(schema.personName, eq(schema.personName.personId, schema.user.personId))
    .where(eq(schema.personName.preferred, true))
    .all();

  const match = rows.find(
    (r) => r.name?.toLowerCase() === username.toLowerCase(),
  );
  if (!match) return undefined;

  return db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, match.userId))
    .get();
}

function getStoredPassword(
  db: BetterSQLite3Database<typeof schema>,
  userId: number,
): string | undefined {
  const row = db
    .select()
    .from(schema.userAuthentication)
    .where(
      and(
        eq(schema.userAuthentication.userId, userId),
        eq(schema.userAuthentication.service, AUTH_SERVICE),
        eq(schema.userAuthentication.key, AUTH_KEY),
      ),
    )
    .get();
  return row?.value ?? undefined;
}

/**
 * Register authentication routes and the `authenticate` request hook.
 *
 * - `POST /auth/login` — validate credentials, issue JWT
 * - `POST /auth/refresh` — refresh an expiring token
 * - `app.authenticate` — preHandler hook for protected routes
 *
 * When `auth_status` is `"disabled"`, the authenticate hook bypasses
 * verification and attaches the default admin user to the request.
 *
 * Wrapped with fastify-plugin to expose decorators to the parent scope —
 * `app.authenticate` must be visible to route plugins registered later.
 */
export const authPlugin = fp<AuthPluginOptions>(async function authPlugin(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  const db = drizzle(opts.db, { schema });

  app.decorate(
    'authenticate',
    async function authenticateHook(request: FastifyRequest, reply: FastifyReply) {
      const authStatus = getAuthStatus(db);

      if (authStatus === 'disabled') {
        request.userId = getDefaultUserId(db);
        return;
      }

      try {
        const decoded = await request.jwtVerify<JwtPayload>();
        request.userId = decoded.userId;
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'username and password are required' });
    }

    const { username, password } = parsed.data;

    const user = findUserByUsername(db, username);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const storedHash = getStoredPassword(db, user.id);
    if (!storedHash) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await compare(password, storedHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ userId: user.id });
    return reply.send({ token });
  });

  app.post('/auth/refresh', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    if (request.userId === undefined) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const token = app.jwt.sign({ userId: request.userId });
    return reply.send({ token });
  });
}, { name: 'auth' });

/**
 * Hash a plaintext password with BCrypt (cost factor 12).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a BCrypt hash.
 */
export async function verifyPassword(plaintext: string, hashed: string): Promise<boolean> {
  return compare(plaintext, hashed);
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: number;
  }
}
