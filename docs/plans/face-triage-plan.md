# Face Triage System — Implementation Plan

## Overview

A two-phase workflow for efficiently associating detected faces with people:

1. **Cluster Inbox** — Auto-grouped unlinked faces presented as cards to name or assign in bulk
2. **Confirmation Cards** — Binary yes/no decisions for remaining stragglers

Accessible as a sub-page under People at `/people/triage`.

## Phase 1: Backend — Cluster Discovery & Bulk Assignment

**New file: `src/server/routes/face-triage.ts`**

Three new endpoints, wrapped in a standard Fastify plugin (`fp`-wrapped, `preHandler: [app.authenticate]`, Zod v4 validation, Drizzle query builder):

### `GET /faces/unlinked/clusters`

The core new query. Finds all features with no `person_feature` row, then groups them into connected components via the `feature_match` graph (reusing the BFS pattern from `FaceMatcher`). Returns clusters sorted by size (largest first), each with representative face IDs and total count. Paginated at the cluster level.

Response shape:

```json
{
  "clusters": [
    {
      "representativeFeatureId": 42,
      "featureIds": [42, 87, 103, 215],
      "size": 4
    }
  ],
  "offset": 0,
  "limit": 20,
  "total": 35,
  "totalUnlinkedFaces": 142
}
```

Implementation approach:
1. Query all feature IDs that have no `person_feature` row (`LEFT JOIN ... WHERE pf.id IS NULL`)
2. Load the `feature_match` edges (non-ignored) for those feature IDs
3. Build connected components via union-find or BFS
4. Sort clusters by size descending
5. Paginate the cluster list
6. For each cluster, pick the representative as the feature with the lowest ID (stable, deterministic)

### `GET /faces/cluster/:featureId/candidates`

For a given face (or cluster representative), returns the top N existing people ranked by how many `feature_match` links exist between the cluster's features and that person's linked features. Falls back gracefully when no match links exist.

Response shape:

```json
{
  "candidates": [
    {
      "personId": 5,
      "names": [{ "id": 1, "name": "Alice", "preferred": true }],
      "firstFeature": { "featureId": 99 },
      "photoCount": 23,
      "matchScore": 7
    }
  ]
}
```

Implementation approach:
1. Get the cluster's feature IDs (BFS from the given feature through unlinked features)
2. Find all `feature_match` rows where one side is in the cluster and the other side is linked to a person (via `person_feature`)
3. Group by person, count matches as `matchScore`
4. Join person names and first feature for display
5. Return top 5 candidates sorted by matchScore descending

### `POST /faces/bulk-assign`

Accepts two modes:
- `{ personId: number, featureIds: number[] }` — link all features to an existing person
- `{ name: string, featureIds: number[] }` — create a new person, add the name (preferred), then link all features

Response: `{ success: true, personId: number, assigned: number }`

Fires `notifications.notify('update', 'person', ...)` and `notifications.notify('update', 'personFeature', ...)`.

### `POST /faces/ignore-match`

Accepts `{ featureId: number, matchingFeatureId: number }` and sets `ignoreMatch = true` on the corresponding `feature_match` row. Used by the "No" button in confirmation cards.

**Registration:** Add plugin import + `await server.register(faceTriagePlugin, { db, notificationService })` in `src/server/app.ts`.

## Phase 2: Frontend API Client

**Modified file: `web/src/lib/api.ts`**

New types:

```typescript
interface FaceCluster {
  representativeFeatureId: number
  featureIds: number[]
  size: number
}

interface UnlinkedClustersResponse {
  clusters: FaceCluster[]
  offset: number
  limit: number
  total: number
  totalUnlinkedFaces: number
}

interface PersonCandidate {
  personId: number
  names: PersonName[]
  firstFeature: { featureId: number } | null
  photoCount: number
  matchScore: number
}
```

New methods:

```typescript
unlinkedClusters(options?: PaginationOptions) → UnlinkedClustersResponse
clusterCandidates(featureId: number) → { candidates: PersonCandidate[] }
bulkAssignFaces(personId: number, featureIds: number[]) → { success: true; personId: number; assigned: number }
bulkCreatePerson(name: string, featureIds: number[]) → { success: true; personId: number; assigned: number }
ignoreMatch(featureId: number, matchingFeatureId: number) → { success: true }
```

## Phase 3: Frontend — Cluster Inbox Page

**New file: `web/src/pages/face-triage.tsx`**

The main triage interface, registered at `/people/triage`.

### Layout

- Header: "Face Triage" title + count badge ("35 clusters · 142 faces")
- Back link to `/people`
- Scrollable list of cluster cards, largest clusters first
- Empty state when all faces are assigned

### Cluster Card (multi-face clusters)

Each card shows:
- **Representative face thumbnail** — large (80×80 circle)
- **Filmstrip** — row of smaller face thumbnails from the cluster (up to ~8, with "+N more" overflow)
- **Size badge** — e.g. "4 faces"
- **Top candidate suggestion** — if a candidate person exists with matchScore > 0, show their name + face thumbnail with a "This is [Name]" quick-assign button
- **Action buttons:**
  - **"This is [Name]"** — one-tap bulk assign to the top candidate person (only shown when a candidate exists)
  - **"Name"** — inline text input that appears on click; submit creates new person + assigns all cluster faces
  - **"Assign to..."** — opens PersonSearchList modal (reuse from `faces-section.tsx`)
  - **Expand toggle** — shows all face thumbnails; individual faces can be deselected before assignment

### Confirmation Card Mode (single-face clusters)

For clusters of size 1 where a candidate person exists:
- Shows the unlinked face large on the left
- Shows the candidate person's face + name on the right
- Two buttons: **"Yes, this is [Name]"** / **"Not [Name]"**
- Keyboard shortcuts: `Y` / `N` for rapid-fire decisions
- "Yes" calls `bulkAssignFaces`
- "No" calls `ignoreMatch` to suppress future suggestions

### Hooks & Patterns

- `useInfiniteScroll` for paginated cluster loading
- `useAutoRefresh(['feature', 'personFeature', 'person'], refetch)` for live updates
- `useFetch` for candidate lookups per-cluster (lazy, on expand or when card is visible)

### Reusable Components

These already exist and should be reused directly:
- `PersonSearchList` + `ModalBackdrop` from `faces-section.tsx` (extract to shared component or import)
- `EmptyState`, `FetchError`, `LoadMoreSentinel`, `Skeleton`, `Badge`, `IconButton`, `SectionCard` from primitives

## Phase 4: Navigation & Integration

### Router

`web/src/router.tsx` — Add route:
```
{ path: 'people/triage', element: <FaceTriagePage /> }
```

### People Page Banner

`web/src/pages/people.tsx` — Add a contextual banner at the top of the People page when unlinked clusters exist:

> **42 unassigned face clusters** — [Review now →](/people/triage)

This requires a lightweight endpoint or piggybacking on the clusters endpoint with `limit=0` to get just the totals.

## File Inventory

| Action | File |
|--------|------|
| Create | `src/server/routes/face-triage.ts` |
| Create | `web/src/pages/face-triage.tsx` |
| Modify | `src/server/app.ts` (register plugin) |
| Modify | `web/src/lib/api.ts` (types + methods) |
| Modify | `web/src/router.tsx` (add route + import) |
| Modify | `web/src/pages/people.tsx` (add triage banner) |
| Create | `test/server/routes/face-triage.test.ts` |

## Key Design Decisions

- **Clusters computed server-side.** The connected-component grouping uses the existing `feature_match` graph and runs on the server. No new ML inference needed; just graph traversal of existing data.

- **Candidate ranking by match-link count.** Rather than re-computing cosine similarity at query time, rank candidates by how many `feature_match` edges connect the cluster to a person's linked features. This is fast (pure SQL joins) and correlates well with actual similarity.

- **`ignoreMatch` for "No" decisions.** Already exists in the schema. Setting it prevents the pair from appearing in future BFS traversals, so dismissed suggestions stay dismissed.

- **Reuse existing components.** `PersonSearchList`, `ModalBackdrop`, `EmptyState`, `FetchError`, `LoadMoreSentinel`, `Skeleton` all apply directly. Consider extracting `PersonSearchList` and `ModalBackdrop` from `faces-section.tsx` into shared components if not already shared.

- **Keyboard shortcuts for confirmation cards.** Y/N keys make rapid triage possible — the goal is to process dozens of decisions per minute for the single-face tail.

- **No new sidebar entry.** Triage lives under `/people/triage` and is accessed via the People page banner. This keeps the sidebar clean and makes the feature discoverable without being permanent clutter.

## Implementation Order

1. Backend endpoints (`face-triage.ts`) + registration in `app.ts`
2. Backend tests (`face-triage.test.ts`)
3. API client additions (`api.ts`)
4. Triage page (`face-triage.tsx`) — cluster cards first, confirmation cards second
5. Router + People page banner integration
6. Polish: keyboard shortcuts, loading states, edge cases
