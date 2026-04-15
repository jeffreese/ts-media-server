---
title: "Face Triage V2 — Enhancements"
date: 2026-04-15
type: handoff
status: ready
---

# Face Triage V2 — Enhancements

## The Problem

The face triage system (Phase 15–17 deliverable) works end-to-end: faces are detected during indexing, clustered by embedding similarity, and presented in a triage UI where users assign them to people. But real-world usage exposed friction in the workflow that makes it tedious for libraries with 800+ faces:

1. **Clusters with no suggestion are shown equally to clusters with strong matches.** The user must scan every card to find actionable ones, instead of processing high-confidence matches first.
2. **Ambiguous face thumbnails can't be verified.** Small 40px crops often aren't enough to identify someone — users need to see the original photo for context.
3. **Non-person detections (artwork, TV screens, blurry crops) clutter the triage queue.** There's no way to permanently dismiss them.
4. **Duplicate person records** can accumulate when the same person is named twice across different clusters. There's a backend merge endpoint but no UI for it.
5. **Triage is mouse-only for clusters.** Confirmation cards have Y/N keyboard shortcuts, but cluster cards (the bulk of the work) have none.
6. **The clustering threshold is hardcoded.** The optimal value depends on library composition — lots of one person vs. many unique faces — but users can't adjust it.
7. **Wrong suggestions can't be suppressed per-person.** If the system keeps suggesting "Jeff Reese" for a non-Jeff cluster, the only option is to ignore the entire match pair. There's no way to say "this cluster is not Jeff" and have the system remember.

The user explicitly approved all seven enhancements and asked for them to be implemented. They are captured in `docs/implementation-roadmap.md` as Phase 18.

## Options Explored

### Option A: Centroid-to-centroid candidate scoring
The original approach. Computes a single centroid per person from all their linked face embeddings, then compares cluster centroid to person centroid.

**Verdict: Rejected.** When a person has many diverse linked faces (different angles, lighting, ages), their centroid becomes a generic "average face" vector. With 18 Jeff Reese faces, the centroid had 0.987 cosine similarity to another person's centroid. Every cluster scored above 0.75 against Jeff. The centroid washes out discriminative signal.

### Option B: Best single-face match
Score by the maximum cosine similarity between any cluster face and any person face.

**Verdict: Rejected.** With 18 diverse person faces, there's always one that vaguely matches any input face. 64 out of 100 random faces scored >=0.70 against some Jeff face.

### Option C: Top-K face-to-face scoring (adopted)
Take the representative face, compare to every linked face of the candidate person, average the top-K (K=5) highest similarities. Only suggest when that average exceeds a threshold.

**Verdict: Adopted.** This requires the face to resemble *multiple* of the person's known faces, not just one outlier. Dropped Jeff's candidate appearances from ~36 clusters to ~7-11. Combined with a 0.65 minimum score threshold, false suggestions are dramatically reduced.

### Clustering algorithm evolution

**Union-find (original):** Collapsed everything into one mega-cluster via transitive links in the dense `feature_match` graph. Rejected immediately.

**Greedy centroid (iteration 2):** Centroid drift caused snowballing — large clusters attracted unrelated faces because the centroid regressed toward the population mean.

**Average-linkage with size cap (adopted):** A face only joins a cluster if its average similarity to *all existing members* meets the threshold AND the cluster hasn't reached the size cap (20). This prevents drift and keeps clusters manageable.

### Face recognition model

**SFace 2021 (original):** 128-dim embeddings. Median random-pair similarity was 0.81, same-person similarity was 0.92. The gap was too small for effective thresholding. Rejected.

**ArcFace w600k_r50 (adopted):** 512-dim embeddings. Median random-pair similarity is 0.568, same-person pairs are 0.8+. Much better separation. The model file is `models/w600k_r50.onnx`, configured via the `faceRecognitionModelPath` database setting.

## The Approach

Phase 18 implements seven features in priority order, each building on the existing triage infrastructure. The approach leans on patterns from Google Photos (merge by naming), Apple Photos ("This is not [Name]"), and Immich (progressive threshold tuning).

The system should optimize for **throughput** — the goal is dozens of decisions per minute. Every interaction that requires a mouse click where a keystroke would do, or shows information the user must mentally filter, is a tax on throughput.

## Key Insights

- **Centroid-based scoring is fundamentally unsuited for diverse face sets.** A person with 18 photos from different decades has a centroid that looks like "generic human face." The top-K approach avoids this by requiring similarity to multiple specific faces rather than one averaged vector.

- **The ArcFace model's embedding space has a median random-pair similarity of 0.568.** This means any threshold below ~0.55 will merge most faces. The current clustering threshold of 0.55 with average-linkage verification produces ~100 clusters from ~800 faces.

- **Average-linkage verification is critical.** Without it, centroid drift causes a snowball effect where one large cluster absorbs everything. The verification step (checking average similarity to all existing members, not just the centroid) prevents this even without a size cap, though the cap is a useful safety net.

- **The `feature_match` table still exists and is populated, but it's no longer used for clustering or candidate scoring.** Both now operate directly on embeddings stored in `feature.info.embedding`. The `feature_match` table is only used for the confirmation card "No" button (`ignoreMatch`). Consider whether it's still needed or should be replaced by a lighter-weight rejection table.

- **Person-feature links from a bad model are poison.** When we switched from SFace to ArcFace, the old links made every person's centroid nearly identical (Jeff vs. Olga: 0.987 similarity). A "Reset Face Assignments" admin action was added at `POST /admin/reset-face-assignments` for exactly this scenario.

- **The user strongly prefers opt-in selection.** The original UI had all faces pre-selected with an exclusion model (click to remove). The user explicitly asked for the opposite: start with nothing selected, click to include. This is the correct pattern for triage where cluster purity is uncertain.

- **Cluster size cap of 20 is a UX constraint, not a ML one.** The cap exists because reviewing more than ~20 faces in a filmstrip is unwieldy. The actual same-person cluster might be larger, but the user processes it in 20-face chunks.

## Design Principles

1. **High-confidence first.** Surface the easiest decisions at the top. Users should be able to process the first 10 clusters in under a minute.

2. **Opt-in over opt-out.** For destructive or assignment actions, require explicit selection. Don't pre-select anything.

3. **Stay in flow.** Context views (source photo), keyboard shortcuts, and modals should keep the user on the triage page. Avoid full-page navigations that break the rhythm.

4. **Rejection is signal.** When a user says "this is not Jeff," that information should persist and improve future suggestions, not just dismiss the current one.

5. **Thresholds are tunable, not fixed.** Different libraries need different settings. Expose controls rather than searching for a "universal" threshold.

6. **Non-person detections are inevitable.** Artwork, TV screens, logos — the face detector will find them. Provide a first-class "ignore" action rather than forcing users to create dummy person records.

## Implementation Plan

### Phase 1: Sort Clusters by Candidate Confidence

This is the highest-impact change — it makes the triage page immediately more useful without any backend changes.

1. **Backend: return `matchScore` with each cluster** — The `GET /faces/unlinked/clusters` endpoint currently returns clusters sorted by size. Modify it to also compute the top candidate score for each cluster (using the existing top-K scoring from the candidates endpoint). Return a `topCandidateScore` field per cluster. This requires running the candidate scoring inline during cluster generation, which adds computation but keeps the data in a single response.

   Alternative: keep the current endpoint shape but have the frontend fetch candidates for all visible clusters (it already does this per-card via `useFetch`) and sort client-side once all responses arrive. This avoids backend changes but delays sorting until all candidate fetches complete. **Recommendation:** Do the client-side approach first since it requires zero backend changes — just reorder the cluster list in `FaceTriagePage` once candidate data is loaded.

2. **Frontend: three-tier sort** — Group clusters into: (a) clusters with a candidate suggestion, sorted by score descending; (b) multi-face clusters with no candidate, sorted by size descending; (c) single-face clusters. This maps naturally to the existing `multiClusters` / `singleClusters` split — just add a sub-sort within `multiClusters`.

### Phase 2: Face-in-Context View

1. **Backend: feature → media item resolution** — The `feature` table already has `itemId` linking to `media_item`. Add a lightweight endpoint or extend the cluster response to include `itemId` per feature. Alternatively, use the existing `GET /mediaItem/:id` endpoint from the frontend.

2. **Frontend: popover on face click** — When a user clicks a face thumbnail in the triage filmstrip (instead of toggling selection, which uses a different gesture), show a popover/panel with:
   - The full source photo (via `api.imageUrl(itemId, { width: 640 })`)
   - Date and folder path
   - A "Select" / "Deselect" toggle for that face
   
   **Gesture design:** Currently, click toggles selection. Options: (a) single-click selects, double-click or long-press shows context; (b) click shows context with a checkbox overlay for selection; (c) add a small "expand" icon on hover. The user values speed, so **(a)** — keeping click for selection and adding a secondary gesture for context — is safest.

3. **Frontend: include `itemId` in the cluster data** — Modify the clusters endpoint to return `featureIds` as `{ featureId, itemId }[]` instead of `number[]`, or add a separate lookup. The `feature` table already stores `itemId`, so this is a join addition in `loadUnlinkedFeatures`.

### Phase 3: Hide/Ignore Face Action

1. **Schema: add `ignored` column to `feature`** — `integer('ignored', { mode: 'boolean' }).notNull().default(false)`. Generate a Drizzle migration.

2. **Backend: filter ignored features from clustering** — In `loadUnlinkedFeatures()`, add `eq(schema.feature.ignored, false)` to the WHERE clause. This removes ignored faces from all triage operations.

3. **Backend: endpoint to toggle ignore** — `POST /faces/:featureId/ignore` sets `feature.ignored = true`. `POST /faces/:featureId/unignore` reverses it. Or a single `PATCH /faces/:featureId` with `{ ignored: boolean }`.

4. **Frontend: ignore button per face** — In the expanded filmstrip, add a small X/ban icon on each face thumbnail (visible on hover). Clicking it calls the ignore endpoint and removes the face from the cluster card. Add an "Ignored Faces" section or counter in admin for reversibility.

### Phase 4: Merge Duplicate People

The backend already has `POST /person/:personId/merge` with `{ sourcePersonId }` — it transfers all features and names from source to target, then deletes the source. The `web/src/lib/api.ts` client likely already has the method (verify).

1. **Frontend: merge UI on person detail page** — Add a "Merge into another person" button. Opens the `PersonSearchList` modal. On selection, calls the merge endpoint with the current person as source and the selected person as target.

2. **Frontend: merge from People listing** — Allow multi-select on the People grid page. When 2+ are selected, show a "Merge" action that picks the first as target and merges the rest into it.

### Phase 5: Keyboard Shortcuts for Cluster Triage

1. **Focus management** — Track which cluster card is "focused" (active) with a `focusedIndex` state in `FaceTriagePage`. Render a visible ring/border on the focused card.

2. **Key bindings:**
   - `↑` / `↓` or `j` / `k` — move focus between cluster cards
   - `a` — select all faces in focused cluster
   - `Enter` — quick-assign to suggested candidate (if one exists)
   - `n` — open "Name this person" input
   - `l` — open "Link to existing person" modal
   - `Escape` — clear selection / close modal

3. **Shortcut legend** — Add a small `?` button in the triage header that shows the shortcut reference.

4. **Guard against input conflicts** — All key handlers should check `e.target` isn't an input/textarea (pattern already used in `ConfirmationCard`).

### Phase 6: Adjustable Clustering Strictness

1. **Backend: accept `threshold` query param** — Modify `GET /faces/unlinked/clusters` to accept an optional `threshold` parameter (clamped to 0.40–0.70). Default to current `CLUSTER_SIMILARITY_THRESHOLD` (0.55).

2. **Frontend: slider in triage header** — A range input labeled "Strictness" with labels "Loose" (0.40) and "Strict" (0.70). Changing it re-fetches clusters with the new threshold. Debounce the fetch by 300ms.

3. **Persistence** — Store the last-used value in `localStorage` under a key like `face-triage-threshold`. Read on mount.

4. **Explainer text** — Tooltip or subtitle: "Higher = smaller, purer clusters. Lower = larger, more inclusive clusters."

### Phase 7: "Not This Person" Rejection Tracking

1. **Schema: new `face_rejection` table** — `(id, featureId, personId, createdAt)` with a unique index on `(featureId, personId)`. This is cleaner than overloading `feature_match.ignoreMatch` because rejections are feature→person, not feature→feature.

   Alternative: store rejections in `feature.info` as a `rejectedPersonIds` array. Simpler (no migration), but harder to query and loses audit trail. **Recommendation:** New table — it's cleaner and queryable.

2. **Backend: record rejection** — `POST /faces/:featureId/reject` with `{ personId }`. Inserts into `face_rejection`. The candidates endpoint filters out rejected persons for the given feature when building the scored list.

3. **Backend: apply rejection filter** — In the candidates endpoint, after loading `personEmbeddings`, query `face_rejection` for the representative `featureId` and exclude those `personId`s from scoring.

4. **Frontend: "Not [Name]" button** — On cluster cards with a candidate suggestion, add a "Not [Name]" button (styled like the confirmation card's "No" button). Calls the reject endpoint, then refreshes — the next-best candidate (if any) appears, or the suggestion disappears.

## Open Questions

1. **Should the `feature_match` table be deprecated?** It's populated during indexing but no longer used for clustering or candidate scoring (both operate on raw embeddings now). The only consumer is the confirmation card "No" button, which sets `ignoreMatch`. The new `face_rejection` table (Phase 7) would replace even that use case. Consider dropping `feature_match` population from the indexing pipeline to save time and storage.

2. **Cluster stability across requests.** The current clustering is stateless — it re-runs from scratch on every `GET /faces/unlinked/clusters` call. This means clusters can shift as faces are assigned. Is this acceptable, or should clusters be cached/persisted between requests? Current approach is fine for ~800 faces but may need caching at 10K+.

3. **Face-in-context gesture design.** Single-click is currently used for selection toggle. Adding a context view needs a different gesture. Double-click? Long-press? Hover preview? Or a dedicated icon overlay? The user values speed, so whatever is chosen should not slow down the primary selection workflow.

4. **Merge direction matters for "preferred" name.** When merging person A into person B, which names become preferred? Current backend transfers all names from source and marks them non-preferred. Is this always correct, or should the user choose?

5. **Progressive threshold workflow.** Immich recommends starting strict and lowering gradually. Should we add workflow guidance (e.g., "You've processed all strict clusters — try lowering strictness to find more matches") or keep it manual?

## How to Start

1. **Read these files first:**
   - `src/server/routes/face-triage.ts` — the entire clustering and candidate scoring backend
   - `web/src/pages/face-triage.tsx` — the full triage UI (ClusterCard, ConfirmationCard, TriageAssignModal)
   - `web/src/lib/api.ts` — search for `FaceCluster`, `PersonCandidate`, `unlinkedClusters`, `clusterCandidates`
   - `src/db/schema.ts` — the `feature`, `featureMatch`, `person`, `personFeature` tables

2. **Start with Phase 1 (confidence sorting)** — it's the highest-impact, lowest-risk change. Modify `FaceTriagePage` to reorder `multiClusters` by whether they have a candidate and the candidate's score. This is entirely frontend, zero backend changes.

3. **Validate before going further:** After Phase 1, restart the server and verify that clusters with suggestions appear at the top of the triage page, and clusters without suggestions appear below. This confirms the candidate data flow is working correctly.

4. **Key constants to know:**
   - `CLUSTER_SIMILARITY_THRESHOLD = 0.55` — minimum avg-linkage similarity to join a cluster
   - `MAX_CLUSTER_SIZE = 20` — per-cluster face cap
   - `CANDIDATE_MIN_SCORE = 0.65` — minimum top-K average to suggest a person
   - `CANDIDATE_TOP_K = 5` — how many of the person's nearest faces to average

5. **Existing backend infrastructure:**
   - `POST /person/:personId/merge` — already exists in `src/server/routes/people.ts`
   - `POST /person/:personId/features/unlink` — already exists
   - `POST /admin/reset-face-assignments` — nuclear reset, already exists
   - `POST /admin/re-embed-faces` — re-extract all embeddings, already exists
