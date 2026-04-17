import { describe, it, expect, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createDatabaseClient, type DatabaseClient } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrate.js';
import { seedDatabase } from '../../../src/db/seed.js';
import { createApp, type App } from '../../../src/server/app.js';
import * as schema from '../../../src/db/schema.js';
import type { Config } from '../../../src/config/schema.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    logLevel: 'silent',
    database: { path: ':memory:' },
    thumbnails: { sizes: ['300x300'] },
    concurrency: 1,
    jwt: { secret: 'test-secret', expiresIn: '1h' },
    ...overrides,
  };
}

const loggerOptions = { level: 'silent' as const };

/**
 * Create a deterministic unit-length embedding vector.
 * Vectors with the same base index will be nearly identical (high cosine sim);
 * different base indices produce orthogonal vectors (low cosine sim).
 */
function makeEmbedding(baseIndex: number, dim = 128, noise = 0): number[] {
  const vec = new Array(dim).fill(0);
  vec[baseIndex % dim] = 1;
  if (noise > 0) {
    vec[(baseIndex + 1) % dim] = noise;
  }
  const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  return vec.map((v: number) => v / norm);
}

function seedGraph(client: DatabaseClient) {
  const db = drizzle(client.db, { schema });

  const itemA = db.insert(schema.mediaItem).values({ name: 'a', type: 'image' }).returning().get();
  const itemB = db.insert(schema.mediaItem).values({ name: 'b', type: 'image' }).returning().get();
  const itemC = db.insert(schema.mediaItem).values({ name: 'c', type: 'image' }).returning().get();
  const itemD = db.insert(schema.mediaItem).values({ name: 'd', type: 'image' }).returning().get();

  // A, B, C get similar embeddings (same base direction); D gets an orthogonal one
  const fA = db.insert(schema.feature).values({ itemId: itemA.id, info: { embedding: makeEmbedding(0) } }).returning().get();
  const fB = db.insert(schema.feature).values({ itemId: itemB.id, info: { embedding: makeEmbedding(0, 128, 0.05) } }).returning().get();
  const fC = db.insert(schema.feature).values({ itemId: itemC.id, info: { embedding: makeEmbedding(0, 128, 0.1) } }).returning().get();
  const fD = db.insert(schema.feature).values({ itemId: itemD.id, info: { embedding: makeEmbedding(64) } }).returning().get();

  const iso = new Date().toISOString();
  db.insert(schema.featureMatch)
    .values({ featureId: fA.id, matchingFeatureId: fB.id, matchInfo: { similarity: 0.9, match_date: iso } })
    .run();
  db.insert(schema.featureMatch)
    .values({ featureId: fB.id, matchingFeatureId: fC.id, matchInfo: { similarity: 0.85, match_date: iso } })
    .run();

  return { fA, fB, fC, fD, itemA, itemB, itemC, itemD };
}

describe('face triage routes', () => {
  const clients: DatabaseClient[] = [];
  let app: App;

  function setupDb(): DatabaseClient {
    const client = createDatabaseClient({ path: ':memory:', enableSpatialite: false });
    clients.push(client);
    runMigrations(client);
    seedDatabase(client);
    return client;
  }

  afterEach(async () => {
    await app?.close();
    for (const c of clients) {
      c.db.close();
    }
    clients.length = 0;
  });

  describe('GET /faces/unlinked/clusters', () => {
    it('returns clusters of unlinked faces grouped by feature_match graph', async () => {
      const client = setupDb();
      const { fA, fB, fC, fD, itemA, itemB, itemC, itemD } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(2);
      expect(body.totalUnlinkedFaces).toBe(4);

      // Largest cluster first (3 faces: A, B, C) — both have null candidate so size breaks tie
      expect(body.clusters[0].size).toBe(3);
      expect(body.clusters[0].featureIds).toContain(fA.id);
      expect(body.clusters[0].featureIds).toContain(fB.id);
      expect(body.clusters[0].featureIds).toContain(fC.id);
      expect(body.clusters[0].features).toEqual(
        expect.arrayContaining([
          { featureId: fA.id, itemId: itemA.id },
          { featureId: fB.id, itemId: itemB.id },
          { featureId: fC.id, itemId: itemC.id },
        ]),
      );
      expect(body.clusters[0].topCandidateScore).toBeNull();
      expect(body.clusters[0].topCandidatePersonId).toBeNull();

      // Single face cluster (D)
      expect(body.clusters[1].size).toBe(1);
      expect(body.clusters[1].featureIds).toEqual([fD.id]);
      expect(body.clusters[1].features).toEqual([{ featureId: fD.id, itemId: itemD.id }]);
      expect(body.clusters[1].topCandidateScore).toBeNull();
    });

    it('excludes features already linked to a person', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB, fC, fD } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fA.id, info: null }).run();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fB.id, info: null }).run();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fC.id, info: null }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(1);
      expect(body.totalUnlinkedFaces).toBe(1);
      expect(body.clusters[0].featureIds).toEqual([fD.id]);
    });

    it('returns empty when all faces are linked', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB, fC, fD } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      for (const f of [fA, fB, fC, fD]) {
        db.insert(schema.personFeature).values({ personId: person.id, featureId: f.id, info: null }).run();
      }

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(0);
      expect(body.clusters).toHaveLength(0);
    });

    it('paginates clusters', async () => {
      const client = setupDb();
      seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?offset=0&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(2);
      expect(body.clusters).toHaveLength(1);
      expect(body.clusters[0].size).toBe(3);
    });

    it('accepts a custom threshold to control clustering strictness', async () => {
      const client = setupDb();
      seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const looseRes = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200&threshold=0.40',
      });
      expect(looseRes.statusCode).toBe(200);
      const looseBody = looseRes.json();
      const looseTotalClusters = looseBody.total;

      const strictRes = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200&threshold=0.70',
      });
      expect(strictRes.statusCode).toBe(200);
      const strictBody = strictRes.json();
      const strictTotalClusters = strictBody.total;

      // Stricter threshold should produce at least as many clusters as loose
      expect(strictTotalClusters).toBeGreaterThanOrEqual(looseTotalClusters);
    });

    it('uses the default threshold when no threshold param is provided', async () => {
      const client = setupDb();
      seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const defaultRes = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });
      expect(defaultRes.statusCode).toBe(200);

      const withThresholdRes = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200&threshold=0.55',
      });
      expect(withThresholdRes.statusCode).toBe(200);

      // Explicitly passing the default value should produce identical results
      expect(defaultRes.json().total).toBe(withThresholdRes.json().total);
    });

    it('rejects threshold below 0.40', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?threshold=0.30',
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects threshold above 0.70', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?threshold=0.90',
      });
      expect(response.statusCode).toBe(400);
    });

    it('sorts clusters with candidate suggestions before those without', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });

      // Create two groups of unlinked faces with different embeddings
      const itemX = db.insert(schema.mediaItem).values({ name: 'x', type: 'image' }).returning().get();
      const itemY = db.insert(schema.mediaItem).values({ name: 'y', type: 'image' }).returning().get();
      const itemZ = db.insert(schema.mediaItem).values({ name: 'z', type: 'image' }).returning().get();
      const itemW = db.insert(schema.mediaItem).values({ name: 'w', type: 'image' }).returning().get();

      // Group 1 (X, Y): direction 0 — will match the person below
      const fX = db.insert(schema.feature).values({ itemId: itemX.id, info: { embedding: makeEmbedding(0) } }).returning().get();
      db.insert(schema.feature).values({ itemId: itemY.id, info: { embedding: makeEmbedding(0, 128, 0.05) } }).returning().get();

      // Group 2 (Z, W): direction 64 — no matching person
      db.insert(schema.feature).values({ itemId: itemZ.id, info: { embedding: makeEmbedding(64) } }).returning().get();
      db.insert(schema.feature).values({ itemId: itemW.id, info: { embedding: makeEmbedding(64, 128, 0.05) } }).returning().get();

      // Create a person linked to a feature in direction 0 (matches group 1)
      const personItem = db.insert(schema.mediaItem).values({ name: 'p', type: 'image' }).returning().get();
      const pF = db.insert(schema.feature).values({
        itemId: personItem.id,
        info: { embedding: makeEmbedding(0, 128, 0.02) },
      }).returning().get();
      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.personName).values({ personId: person.id, name: 'Test Person', preferred: true, info: null }).run();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: pF.id, info: null }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Find the cluster that contains fX (direction 0 — should have a candidate)
      const matchedCluster = body.clusters.find((c: { featureIds: number[] }) => c.featureIds.includes(fX.id));
      expect(matchedCluster).toBeDefined();
      expect(matchedCluster.topCandidateScore).toBeGreaterThan(0);
      expect(matchedCluster.topCandidatePersonId).toBe(person.id);

      // Clusters with candidates should appear before those without
      const firstWithCandidate = body.clusters.findIndex((c: { topCandidateScore: number | null }) => c.topCandidateScore !== null);
      const firstWithout = body.clusters.findIndex((c: { topCandidateScore: number | null }) => c.topCandidateScore === null);
      expect(firstWithCandidate).toBeGreaterThanOrEqual(0);
      expect(firstWithout).toBeGreaterThanOrEqual(0);
      expect(firstWithCandidate).toBeLessThan(firstWithout);
    });
  });

  describe('inline candidates in GET /faces/unlinked/clusters', () => {
    it('returns candidate people inline with clusters', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      // Create a person linked to a feature with a similar embedding to fA's cluster
      const itemE = db.insert(schema.mediaItem).values({ name: 'e', type: 'image' }).returning().get();
      const fE = db.insert(schema.feature).values({
        itemId: itemE.id,
        info: { embedding: makeEmbedding(0, 128, 0.02) },
      }).returning().get();

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.personName).values({ personId: person.id, name: 'Alice', preferred: true, info: null }).run();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fE.id, info: null }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const cluster = body.clusters.find((c: { featureIds: number[] }) => c.featureIds.includes(fA.id));
      expect(cluster).toBeDefined();
      expect(cluster.candidates).toHaveLength(1);
      expect(cluster.candidates[0].personId).toBe(person.id);
      expect(cluster.candidates[0].names[0].name).toBe('Alice');
      expect(cluster.candidates[0].matchScore).toBeGreaterThan(0.9);
    });

    it('returns empty candidates when no person matches a cluster', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const cluster = body.clusters.find((c: { featureIds: number[] }) => c.featureIds.includes(fA.id));
      expect(cluster).toBeDefined();
      expect(cluster.candidates).toHaveLength(0);
    });
  });

  describe('POST /faces/bulk-assign', () => {
    it('links multiple features to an existing person', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB, fC } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/bulk-assign',
        payload: { personId: person.id, featureIds: [fA.id, fB.id, fC.id] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.assigned).toBe(3);
      expect(body.personId).toBe(person.id);

      const links = db
        .select()
        .from(schema.personFeature)
        .where(eq(schema.personFeature.personId, person.id))
        .all();
      expect(links).toHaveLength(3);
    });

    it('skips already-linked features without error', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fA.id, info: null }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/bulk-assign',
        payload: { personId: person.id, featureIds: [fA.id, fB.id] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.assigned).toBe(1);
    });

    it('returns 404 for non-existent person', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/bulk-assign',
        payload: { personId: 99999, featureIds: [fA.id] },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /faces/bulk-create', () => {
    it('creates a new person and links features', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/bulk-create',
        payload: { name: 'Bob', featureIds: [fA.id, fB.id] },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.assigned).toBe(2);

      const names = db
        .select()
        .from(schema.personName)
        .where(eq(schema.personName.personId, body.personId))
        .all();
      expect(names).toHaveLength(1);
      expect(names[0]!.name).toBe('Bob');
      expect(names[0]!.preferred).toBe(true);
    });

    it('returns 400 with empty name', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/bulk-create',
        payload: { name: '', featureIds: [fA.id] },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /faces/ignore-match', () => {
    it('marks a feature match as ignored', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/ignore-match',
        payload: { featureId: fA.id, matchingFeatureId: fB.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const match = db
        .select()
        .from(schema.featureMatch)
        .where(eq(schema.featureMatch.featureId, fA.id))
        .get();
      expect(match!.ignoreMatch).toBe(true);
    });

    it('works with reversed feature ID order', async () => {
      const client = setupDb();
      const { fA, fB } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/ignore-match',
        payload: { featureId: fB.id, matchingFeatureId: fA.id },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 404 for non-existent match', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/ignore-match',
        payload: { featureId: 99998, matchingFeatureId: 99999 },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /faces/:featureId/ignore', () => {
    it('marks a feature as ignored', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: `/faces/${fA.id}/ignore`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const feat = db
        .select()
        .from(schema.feature)
        .where(eq(schema.feature.id, fA.id))
        .get();
      expect(feat!.ignored).toBe(true);
    });

    it('returns 404 for non-existent feature', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/99999/ignore',
      });

      expect(response.statusCode).toBe(404);
    });

    it('excludes ignored faces from unlinked clusters', async () => {
      const client = setupDb();
      const { fA, fD } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      // Ignore fD (the lone cluster face)
      const ignoreRes = await app.server.inject({
        method: 'POST',
        url: `/faces/${fD.id}/ignore`,
      });
      expect(ignoreRes.statusCode).toBe(200);

      const clustersRes = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters',
      });

      expect(clustersRes.statusCode).toBe(200);
      const body = clustersRes.json();
      expect(body.totalUnlinkedFaces).toBe(3);
      expect(body.total).toBe(1);
      const allFeatureIds = body.clusters.flatMap((c: { featureIds: number[] }) => c.featureIds);
      expect(allFeatureIds).not.toContain(fD.id);
      expect(allFeatureIds).toContain(fA.id);
    });
  });

  describe('POST /faces/:featureId/unignore', () => {
    it('restores an ignored feature', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fD } = seedGraph(client);

      // Ignore first
      db.update(schema.feature)
        .set({ ignored: true })
        .where(eq(schema.feature.id, fD.id))
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: `/faces/${fD.id}/unignore`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const feat = db
        .select()
        .from(schema.feature)
        .where(eq(schema.feature.id, fD.id))
        .get();
      expect(feat!.ignored).toBe(false);
    });

    it('unignored feature reappears in clusters', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fD } = seedGraph(client);

      db.update(schema.feature)
        .set({ ignored: true })
        .where(eq(schema.feature.id, fD.id))
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      // Verify it's excluded
      let res = await app.server.inject({ method: 'GET', url: '/faces/unlinked/clusters' });
      expect(res.json().totalUnlinkedFaces).toBe(3);

      // Unignore it
      await app.server.inject({ method: 'POST', url: `/faces/${fD.id}/unignore` });

      // Verify it's back
      res = await app.server.inject({ method: 'GET', url: '/faces/unlinked/clusters' });
      expect(res.json().totalUnlinkedFaces).toBe(4);
      const allFeatureIds = res.json().clusters.flatMap((c: { featureIds: number[] }) => c.featureIds);
      expect(allFeatureIds).toContain(fD.id);
    });

    it('returns 404 for non-existent feature', async () => {
      const client = setupDb();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/99999/unignore',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /faces/ignored', () => {
    it('returns empty when no faces are ignored', async () => {
      const client = setupDb();
      seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/ignored',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('returns ignored faces', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fD } = seedGraph(client);

      db.update(schema.feature)
        .set({ ignored: true })
        .where(eq(schema.feature.id, fA.id))
        .run();
      db.update(schema.feature)
        .set({ ignored: true })
        .where(eq(schema.feature.id, fD.id))
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/ignored',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);
      const ids = body.items.map((i: { id: number }) => i.id);
      expect(ids).toContain(fA.id);
      expect(ids).toContain(fD.id);
    });

    it('supports pagination', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA, fB, fC } = seedGraph(client);

      for (const f of [fA, fB, fC]) {
        db.update(schema.feature)
          .set({ ignored: true })
          .where(eq(schema.feature.id, f.id))
          .run();
      }

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: '/faces/ignored?offset=0&limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(2);
    });
  });

  describe('POST /faces/:featureId/reject', () => {
    it('records a rejection for a feature-person pair', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: person.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const rejection = db
        .select()
        .from(schema.faceRejection)
        .where(eq(schema.faceRejection.featureId, fA.id))
        .get();
      expect(rejection).toBeDefined();
      expect(rejection!.personId).toBe(person.id);
      expect(rejection!.createdAt).toBeTruthy();
    });

    it('is idempotent — duplicate rejection does not error', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      await app.server.inject({
        method: 'POST',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: person.id },
      });

      const response = await app.server.inject({
        method: 'POST',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: person.id },
      });

      expect(response.statusCode).toBe(200);

      const rows = db
        .select()
        .from(schema.faceRejection)
        .where(eq(schema.faceRejection.featureId, fA.id))
        .all();
      expect(rows).toHaveLength(1);
    });

    it('returns 404 for non-existent feature', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const person = db.insert(schema.person).values({ info: null }).returning().get();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: '/faces/99999/reject',
        payload: { personId: person.id },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent person', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'POST',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: 99999 },
      });

      expect(response.statusCode).toBe(404);
    });

    it('excludes rejected person from cluster candidates', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      // Create a person with a similar embedding that would normally be a candidate
      const itemE = db.insert(schema.mediaItem).values({ name: 'e', type: 'image' }).returning().get();
      const fE = db.insert(schema.feature).values({
        itemId: itemE.id,
        info: { embedding: makeEmbedding(0, 128, 0.02) },
      }).returning().get();

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.personName).values({ personId: person.id, name: 'Alice', preferred: true, info: null }).run();
      db.insert(schema.personFeature).values({ personId: person.id, featureId: fE.id, info: null }).run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      // Verify Alice is a candidate before rejection
      let response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });
      let body = response.json();
      let cluster = body.clusters.find((c: { featureIds: number[] }) => c.featureIds.includes(fA.id));
      expect(cluster.candidates.length).toBeGreaterThan(0);
      expect(cluster.candidates[0].personId).toBe(person.id);

      // Reject Alice for fA's cluster representative
      const repId = cluster.representativeFeatureId;
      await app.server.inject({
        method: 'POST',
        url: `/faces/${repId}/reject`,
        payload: { personId: person.id },
      });

      // Verify Alice is no longer a candidate
      response = await app.server.inject({
        method: 'GET',
        url: '/faces/unlinked/clusters?limit=200',
      });
      body = response.json();
      cluster = body.clusters.find((c: { featureIds: number[] }) => c.featureIds.includes(fA.id));
      expect(cluster.candidates).toHaveLength(0);
      expect(cluster.topCandidateScore).toBeNull();
      expect(cluster.topCandidatePersonId).toBeNull();
    });
  });

  describe('DELETE /faces/:featureId/reject', () => {
    it('removes a rejection', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      const person = db.insert(schema.person).values({ info: null }).returning().get();
      db.insert(schema.faceRejection)
        .values({ featureId: fA.id, personId: person.id, createdAt: new Date().toISOString() })
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'DELETE',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: person.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const rows = db
        .select()
        .from(schema.faceRejection)
        .where(eq(schema.faceRejection.featureId, fA.id))
        .all();
      expect(rows).toHaveLength(0);
    });

    it('succeeds even when no rejection exists', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'DELETE',
        url: `/faces/${fA.id}/reject`,
        payload: { personId: 1 },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /faces/:featureId/rejections', () => {
    it('returns rejections for a feature', async () => {
      const client = setupDb();
      const db = drizzle(client.db, { schema });
      const { fA } = seedGraph(client);

      const p1 = db.insert(schema.person).values({ info: null }).returning().get();
      const p2 = db.insert(schema.person).values({ info: null }).returning().get();

      db.insert(schema.faceRejection)
        .values({ featureId: fA.id, personId: p1.id, createdAt: new Date().toISOString() })
        .run();
      db.insert(schema.faceRejection)
        .values({ featureId: fA.id, personId: p2.id, createdAt: new Date().toISOString() })
        .run();

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/faces/${fA.id}/rejections`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      const personIds = body.items.map((r: { personId: number }) => r.personId);
      expect(personIds).toContain(p1.id);
      expect(personIds).toContain(p2.id);
    });

    it('returns empty array when no rejections exist', async () => {
      const client = setupDb();
      const { fA } = seedGraph(client);

      app = await createApp({ config: makeConfig(), db: client.db, loggerOptions });
      await app.server.ready();

      const response = await app.server.inject({
        method: 'GET',
        url: `/faces/${fA.id}/rejections`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(0);
    });
  });
});
