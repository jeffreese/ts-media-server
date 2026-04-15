import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, inArray, isNull, or, count as countFn } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { z } from 'zod/v4';
import * as schema from '../../db/schema.js';
import type { NotificationService } from '../../services/notification.js';

const CLUSTER_SIMILARITY_THRESHOLD = 0.55;
const MAX_CLUSTER_SIZE = 20;
const CANDIDATE_MIN_SCORE = 0.65;
const CANDIDATE_TOP_K = 5;

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().positive().max(200).optional().default(20),
});

const featureIdParams = z.object({
  featureId: z.coerce.number().int().positive(),
});

const bulkAssignBodySchema = z.object({
  personId: z.number().int().positive(),
  featureIds: z.array(z.number().int().positive()).min(1).max(500),
});

const bulkCreateBodySchema = z.object({
  name: z.string().min(1).max(500),
  featureIds: z.array(z.number().int().positive()).min(1).max(500),
});

const ignoreMatchBodySchema = z.object({
  featureId: z.number().int().positive(),
  matchingFeatureId: z.number().int().positive(),
});

export interface FaceTriagePluginOptions {
  db: Database.Database;
  notificationService?: NotificationService;
}

type Db = BetterSQLite3Database<typeof schema>;

interface FeatureWithEmbedding {
  id: number;
  itemId: number;
  embedding: Float32Array;
}

interface Cluster {
  centroid: Float32Array;
  featureIds: number[];
}

// ---------------------------------------------------------------------------
// Average-linkage clustering with size cap
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

/**
 * Compute the L2-normalized average of a set of embeddings.
 */
function normalizedCentroid(embeddings: Float32Array[]): Float32Array {
  const dim = embeddings[0]!.length;
  const avg = new Float32Array(dim);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += e[i]!;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    avg[i] /= embeddings.length;
    norm += avg[i]! * avg[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) avg[i] /= norm;
  }
  return avg;
}

/**
 * Average-linkage clustering with a per-cluster size cap.
 *
 * A face joins the cluster whose centroid is most similar, but only if:
 *  1. The centroid similarity meets the threshold.
 *  2. The face's average cosine similarity to *all existing members* of that
 *     cluster also meets the threshold (average-linkage verification).
 *  3. The cluster hasn't reached `maxSize`.
 *
 * This prevents centroid drift from snowballing unrelated faces into large
 * clusters, and the size cap keeps clusters manageable for the triage UI.
 */
function buildClusters(
  features: FeatureWithEmbedding[],
  threshold: number,
  maxSize: number,
): Cluster[] {
  const clusters: { centroid: Float32Array; embeddings: Float32Array[]; featureIds: number[] }[] = [];

  for (const feat of features) {
    let bestIdx = -1;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i]!.featureIds.length >= maxSize) continue;
      const sim = cosineSimilarity(feat.embedding, clusters[i]!.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    let assigned = false;
    if (bestIdx >= 0 && bestSim >= threshold) {
      const c = clusters[bestIdx]!;
      let totalSim = 0;
      for (const m of c.embeddings) totalSim += cosineSimilarity(feat.embedding, m);
      const avgSim = totalSim / c.embeddings.length;

      if (avgSim >= threshold) {
        c.embeddings.push(feat.embedding);
        c.featureIds.push(feat.id);
        c.centroid = normalizedCentroid(c.embeddings);
        assigned = true;
      }
    }

    if (!assigned) {
      clusters.push({
        centroid: feat.embedding,
        embeddings: [feat.embedding],
        featureIds: [feat.id],
      });
    }
  }

  return clusters;
}

/**
 * Load unlinked features (those not in person_feature) that have a valid
 * embedding in their info JSON.
 */
function loadUnlinkedFeatures(db: Db): FeatureWithEmbedding[] {
  const rows = db
    .select({ id: schema.feature.id, itemId: schema.feature.itemId, info: schema.feature.info })
    .from(schema.feature)
    .leftJoin(schema.personFeature, eq(schema.personFeature.featureId, schema.feature.id))
    .where(and(isNull(schema.personFeature.id), eq(schema.feature.ignored, false)))
    .all();

  const features: FeatureWithEmbedding[] = [];
  for (const row of rows) {
    const embedding = extractEmbedding(row.info);
    if (embedding) {
      features.push({ id: row.id, itemId: row.itemId, embedding });
    }
  }
  return features;
}

/**
 * Load all person embeddings (from linked features) grouped by personId.
 */
function loadPersonEmbeddings(db: Db): Map<number, Float32Array[]> {
  const linkedRows = db
    .select({
      featureId: schema.personFeature.featureId,
      personId: schema.personFeature.personId,
      info: schema.feature.info,
    })
    .from(schema.personFeature)
    .innerJoin(schema.feature, eq(schema.feature.id, schema.personFeature.featureId))
    .all();

  const personEmbeddings = new Map<number, Float32Array[]>();
  for (const row of linkedRows) {
    const embedding = extractEmbedding(row.info);
    if (!embedding) continue;
    const list = personEmbeddings.get(row.personId) ?? [];
    list.push(embedding);
    personEmbeddings.set(row.personId, list);
  }
  return personEmbeddings;
}

/**
 * Score a representative embedding against all known persons using an adaptive
 * top-K average similarity approach. K scales with the number of linked faces
 * so that persons with many diverse embeddings require consistency across a
 * larger sample, preventing a few outlier matches from inflating the score.
 */
function scoreTopCandidate(
  representativeEmbedding: Float32Array,
  personEmbeddings: Map<number, Float32Array[]>,
): { personId: number; score: number } | null {
  let bestPersonId = -1;
  let bestScore = -1;

  for (const [personId, embeddings] of personEmbeddings) {
    const k = Math.max(CANDIDATE_TOP_K, Math.floor(embeddings.length * 0.5));
    const sims = embeddings
      .map((e) => cosineSimilarity(representativeEmbedding, e))
      .sort((a, b) => b - a);
    const topK = sims.slice(0, Math.min(k, sims.length));
    const avgTopK = topK.reduce((a, b) => a + b, 0) / topK.length;

    if (avgTopK >= CANDIDATE_MIN_SCORE && avgTopK > bestScore) {
      bestScore = avgTopK;
      bestPersonId = personId;
    }
  }

  if (bestPersonId < 0) return null;
  return { personId: bestPersonId, score: Math.round(bestScore * 1000) / 1000 };
}

function extractEmbedding(info: unknown): Float32Array | null {
  if (!info || typeof info !== 'object') return null;
  const record = info as Record<string, unknown>;
  const raw = record.embedding;
  if (!Array.isArray(raw)) return null;
  if (!raw.every((v) => typeof v === 'number' && !Number.isNaN(v))) return null;
  return new Float32Array(raw);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Face triage routes for efficient bulk face-to-person assignment.
 *
 * - `GET /faces/unlinked/clusters` — grouped unlinked faces
 * - `GET /faces/cluster/:featureId/candidates` — best person matches for a cluster
 * - `POST /faces/bulk-assign` — link multiple features to an existing person
 * - `POST /faces/bulk-create` — create a person and link multiple features
 * - `POST /faces/ignore-match` — suppress a feature match pair
 * - `POST /faces/:featureId/ignore` — mark a face as ignored (excluded from triage)
 * - `POST /faces/:featureId/unignore` — restore an ignored face
 * - `GET /faces/ignored` — list all ignored faces (paginated)
 */
export const faceTriagePlugin = fp<FaceTriagePluginOptions>(
  async function faceTriagePlugin(
    app: FastifyInstance,
    opts: FaceTriagePluginOptions,
  ): Promise<void> {
    const db: Db = drizzle(opts.db, { schema });
    const notifications = opts.notificationService;

    // -------------------------------------------------------------------
    // GET /faces/unlinked/clusters
    // -------------------------------------------------------------------

    app.get('/faces/unlinked/clusters', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const queryParsed = paginationSchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = queryParsed.data;

      const features = loadUnlinkedFeatures(db);
      const totalUnlinkedFaces = features.length;

      if (features.length === 0) {
        return reply.send({ clusters: [], offset, limit, total: 0, totalUnlinkedFaces: 0 });
      }

      const rawClusters = buildClusters(features, CLUSTER_SIMILARITY_THRESHOLD, MAX_CLUSTER_SIZE);

      const personEmbeddings = loadPersonEmbeddings(db);
      const featureEmbeddingMap = new Map<number, Float32Array>();
      const featureItemMap = new Map<number, number>();
      for (const f of features) {
        featureEmbeddingMap.set(f.id, f.embedding);
        featureItemMap.set(f.id, f.itemId);
      }

      const clusters = rawClusters
        .map((c) => {
          const sorted = [...c.featureIds].sort((a, b) => a - b);
          const representativeId = sorted[0]!;
          const repEmbedding = featureEmbeddingMap.get(representativeId);

          let topCandidateScore: number | null = null;
          let topCandidatePersonId: number | null = null;

          if (repEmbedding && personEmbeddings.size > 0) {
            const result = scoreTopCandidate(repEmbedding, personEmbeddings);
            if (result) {
              topCandidateScore = result.score;
              topCandidatePersonId = result.personId;
            }
          }

          return {
            representativeFeatureId: representativeId,
            featureIds: sorted,
            features: sorted
              .map((fId) => {
                const iId = featureItemMap.get(fId);
                return iId !== undefined ? { featureId: fId, itemId: iId } : null;
              })
              .filter((f): f is NonNullable<typeof f> => f !== null),
            size: sorted.length,
            topCandidateScore,
            topCandidatePersonId,
          };
        })
        .sort((a, b) => {
          const aScore = a.topCandidateScore ?? -1;
          const bScore = b.topCandidateScore ?? -1;
          if (aScore !== bScore) return bScore - aScore;
          if (a.size !== b.size) return b.size - a.size;
          return a.representativeFeatureId - b.representativeFeatureId;
        });

      const total = clusters.length;
      const page = clusters.slice(offset, offset + limit);

      return reply.send({ clusters: page, offset, limit, total, totalUnlinkedFaces });
    });

    // -------------------------------------------------------------------
    // GET /faces/cluster/:featureId/candidates
    // -------------------------------------------------------------------

    app.get('/faces/cluster/:featureId/candidates', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = featureIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid feature ID' });
      }
      const { featureId } = paramsParsed.data;

      const exists = db
        .select({ id: schema.feature.id })
        .from(schema.feature)
        .where(eq(schema.feature.id, featureId))
        .get();

      if (!exists) {
        return reply.code(404).send({ error: 'Feature not found' });
      }

      const features = loadUnlinkedFeatures(db);
      const rawClusters = buildClusters(features, CLUSTER_SIMILARITY_THRESHOLD, MAX_CLUSTER_SIZE);
      const cluster = rawClusters.find((c) => c.featureIds.includes(featureId));

      if (!cluster) {
        return reply.send({ candidates: [] });
      }

      const personEmbeddings = loadPersonEmbeddings(db);

      if (personEmbeddings.size === 0) {
        return reply.send({ candidates: [] });
      }

      const representativeEmbedding = extractEmbedding(
        db.select({ info: schema.feature.info })
          .from(schema.feature)
          .where(eq(schema.feature.id, featureId))
          .get()?.info,
      );

      if (!representativeEmbedding) {
        return reply.send({ candidates: [] });
      }

      const scored: { personId: number; similarity: number }[] = [];
      for (const [personId, embeddings] of personEmbeddings) {
        const k = Math.max(CANDIDATE_TOP_K, Math.floor(embeddings.length * 0.5));
        const sims = embeddings
          .map((e) => cosineSimilarity(representativeEmbedding, e))
          .sort((a, b) => b - a);
        const topK = sims.slice(0, Math.min(k, sims.length));
        const avgTopK = topK.reduce((a, b) => a + b, 0) / topK.length;

        if (avgTopK >= CANDIDATE_MIN_SCORE) {
          scored.push({ personId, similarity: avgTopK });
        }
      }

      scored.sort((a, b) => b.similarity - a.similarity);
      const top = scored.slice(0, 5);

      const personIds = top.map((s) => s.personId);

      if (personIds.length === 0) {
        return reply.send({ candidates: [] });
      }

      const names = db
        .select()
        .from(schema.personName)
        .where(inArray(schema.personName.personId, personIds))
        .all();

      const linkedFeatures = db
        .select({
          id: schema.personFeature.id,
          featureId: schema.personFeature.featureId,
          personId: schema.personFeature.personId,
        })
        .from(schema.personFeature)
        .where(inArray(schema.personFeature.personId, personIds))
        .all();

      const namesByPerson = new Map<number, typeof names>();
      for (const name of names) {
        const list = namesByPerson.get(name.personId) ?? [];
        list.push(name);
        namesByPerson.set(name.personId, list);
      }

      const firstFeatureByPerson = new Map<number, number>();
      const featureCountByPerson = new Map<number, number>();
      for (const feat of linkedFeatures) {
        if (!firstFeatureByPerson.has(feat.personId)) {
          firstFeatureByPerson.set(feat.personId, feat.featureId);
        }
        featureCountByPerson.set(feat.personId, (featureCountByPerson.get(feat.personId) ?? 0) + 1);
      }

      const candidates = top.map(({ personId, similarity }) => ({
        personId,
        names: namesByPerson.get(personId) ?? [],
        firstFeature: firstFeatureByPerson.has(personId)
          ? { featureId: firstFeatureByPerson.get(personId)! }
          : null,
        photoCount: featureCountByPerson.get(personId) ?? 0,
        matchScore: Math.round(similarity * 1000) / 1000,
      }));

      return reply.send({ candidates });
    });

    // -------------------------------------------------------------------
    // POST /faces/bulk-assign
    // -------------------------------------------------------------------

    app.post('/faces/bulk-assign', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const body = bulkAssignBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Request body must include "personId" and "featureIds" array' });
      }
      const { personId, featureIds } = body.data;

      const personExists = db
        .select({ id: schema.person.id })
        .from(schema.person)
        .where(eq(schema.person.id, personId))
        .get();

      if (!personExists) {
        return reply.code(404).send({ error: 'Person not found' });
      }

      let assigned = 0;
      for (const featureId of featureIds) {
        const existing = db
          .select({ id: schema.personFeature.id })
          .from(schema.personFeature)
          .where(and(
            eq(schema.personFeature.personId, personId),
            eq(schema.personFeature.featureId, featureId),
          ))
          .get();

        if (!existing) {
          db.insert(schema.personFeature)
            .values({ personId, featureId, info: null })
            .run();
          assigned++;
        }
      }

      notifications?.notify('update', 'personFeature', { personId });
      notifications?.notify('update', 'person', { id: personId });

      return reply.send({ success: true, personId, assigned });
    });

    // -------------------------------------------------------------------
    // POST /faces/bulk-create
    // -------------------------------------------------------------------

    app.post('/faces/bulk-create', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const body = bulkCreateBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Request body must include "name" and "featureIds" array' });
      }
      const { name, featureIds } = body.data;

      const newPerson = db
        .insert(schema.person)
        .values({ info: null })
        .returning()
        .get();

      db.insert(schema.personName)
        .values({ personId: newPerson.id, name, preferred: true, info: null })
        .run();

      let assigned = 0;
      for (const featureId of featureIds) {
        const feat = db
          .select({ id: schema.feature.id })
          .from(schema.feature)
          .where(eq(schema.feature.id, featureId))
          .get();

        if (feat) {
          db.insert(schema.personFeature)
            .values({ personId: newPerson.id, featureId, info: null })
            .run();
          assigned++;
        }
      }

      notifications?.notify('create', 'person', { id: newPerson.id });
      notifications?.notify('update', 'personFeature', { personId: newPerson.id });

      return reply.send({ success: true, personId: newPerson.id, assigned });
    });

    // -------------------------------------------------------------------
    // POST /faces/ignore-match
    // -------------------------------------------------------------------

    app.post('/faces/ignore-match', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const body = ignoreMatchBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Request body must include "featureId" and "matchingFeatureId"' });
      }
      const { featureId, matchingFeatureId } = body.data;

      const match = db
        .select({ id: schema.featureMatch.id })
        .from(schema.featureMatch)
        .where(or(
          and(
            eq(schema.featureMatch.featureId, featureId),
            eq(schema.featureMatch.matchingFeatureId, matchingFeatureId),
          ),
          and(
            eq(schema.featureMatch.featureId, matchingFeatureId),
            eq(schema.featureMatch.matchingFeatureId, featureId),
          ),
        ))
        .get();

      if (!match) {
        return reply.code(404).send({ error: 'Feature match not found' });
      }

      db.update(schema.featureMatch)
        .set({ ignoreMatch: true })
        .where(eq(schema.featureMatch.id, match.id))
        .run();

      notifications?.notify('update', 'feature', { id: featureId });

      return reply.send({ success: true });
    });

    // -------------------------------------------------------------------
    // POST /faces/:featureId/ignore
    // -------------------------------------------------------------------

    app.post('/faces/:featureId/ignore', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = featureIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid feature ID' });
      }
      const { featureId } = paramsParsed.data;

      const feat = db
        .select({ id: schema.feature.id })
        .from(schema.feature)
        .where(eq(schema.feature.id, featureId))
        .get();

      if (!feat) {
        return reply.code(404).send({ error: 'Feature not found' });
      }

      db.update(schema.feature)
        .set({ ignored: true })
        .where(eq(schema.feature.id, featureId))
        .run();

      notifications?.notify('update', 'feature', { id: featureId });

      return reply.send({ success: true });
    });

    // -------------------------------------------------------------------
    // POST /faces/:featureId/unignore
    // -------------------------------------------------------------------

    app.post('/faces/:featureId/unignore', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const paramsParsed = featureIdParams.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.code(400).send({ error: 'Invalid feature ID' });
      }
      const { featureId } = paramsParsed.data;

      const feat = db
        .select({ id: schema.feature.id })
        .from(schema.feature)
        .where(eq(schema.feature.id, featureId))
        .get();

      if (!feat) {
        return reply.code(404).send({ error: 'Feature not found' });
      }

      db.update(schema.feature)
        .set({ ignored: false })
        .where(eq(schema.feature.id, featureId))
        .run();

      notifications?.notify('update', 'feature', { id: featureId });

      return reply.send({ success: true });
    });

    // -------------------------------------------------------------------
    // GET /faces/ignored
    // -------------------------------------------------------------------

    app.get('/faces/ignored', {
      preHandler: [app.authenticate],
    }, async (request, reply) => {
      const queryParsed = paginationSchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }
      const { offset, limit } = queryParsed.data;

      const totalRow = db
        .select({ count: countFn() })
        .from(schema.feature)
        .where(eq(schema.feature.ignored, true))
        .get();
      const total = totalRow?.count ?? 0;

      const rows = db
        .select({
          id: schema.feature.id,
          itemId: schema.feature.itemId,
          label: schema.feature.label,
        })
        .from(schema.feature)
        .where(eq(schema.feature.ignored, true))
        .limit(limit)
        .offset(offset)
        .all();

      return reply.send({ items: rows, offset, limit, total });
    });
  },
  { name: 'face-triage-routes', dependencies: ['auth'] },
);
