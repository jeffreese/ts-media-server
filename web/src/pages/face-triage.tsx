import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Link2,
  Plus,
  Search,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { Badge, IconButton, Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useFetch } from '~/hooks/use-fetch'
import {
  type FaceCluster,
  type PersonBatchItem,
  type PersonCandidate,
  api,
} from '~/lib/api'

export function FaceTriagePage() {
  const [clusters, setClusters] = useState<FaceCluster[]>([])
  const [total, setTotal] = useState(0)
  const [totalFaces, setTotalFaces] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchClusters = useCallback(() => {
    setIsLoading(true)
    api
      .unlinkedClusters({ limit: 200 })
      .then((res) => {
        setClusters(res.clusters)
        setTotal(res.total)
        setTotalFaces(res.totalUnlinkedFaces)
        setError(null)
      })
      .catch((err) => setError(err))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    fetchClusters()
  }, [fetchClusters])

  useAutoRefresh(['feature', 'personFeature', 'person'], fetchClusters)

  if (error) {
    return (
      <div>
        <TriageHeader total={0} totalFaces={0} />
        <FetchError message={`Failed to load clusters: ${error.message}`} onRetry={fetchClusters} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div>
        <TriageHeader total={0} totalFaces={0} />
        <div className="space-y-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (clusters.length === 0) {
    return (
      <div>
        <TriageHeader total={0} totalFaces={0} />
        <EmptyState
          icon={<Sparkles className="h-12 w-12" />}
          title="All faces assigned"
          description="Every detected face has been linked to a person. Nice work!"
        />
      </div>
    )
  }

  const suggestedClusters = clusters.filter((c) => c.size > 1 && c.topCandidateScore !== null)
  const unsuggestedClusters = clusters.filter((c) => c.size > 1 && c.topCandidateScore === null)
  const singleClusters = clusters.filter((c) => c.size === 1)

  return (
    <div>
      <TriageHeader total={total} totalFaces={totalFaces} />

      {suggestedClusters.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-foreground-muted">
            Suggested ({suggestedClusters.length})
          </h2>
          <div className="space-y-3">
            {suggestedClusters.map((cluster) => (
              <ClusterCard
                key={cluster.representativeFeatureId}
                cluster={cluster}
                onAssigned={fetchClusters}
              />
            ))}
          </div>
        </section>
      )}

      {unsuggestedClusters.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-foreground-muted">
            Clusters ({unsuggestedClusters.length})
          </h2>
          <div className="space-y-3">
            {unsuggestedClusters.map((cluster) => (
              <ClusterCard
                key={cluster.representativeFeatureId}
                cluster={cluster}
                onAssigned={fetchClusters}
              />
            ))}
          </div>
        </section>
      )}

      {singleClusters.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted">
            Individual Faces ({singleClusters.length})
          </h2>
          <div className="space-y-3">
            {singleClusters.map((cluster) => (
              <ConfirmationCard
                key={cluster.representativeFeatureId}
                cluster={cluster}
                onAssigned={fetchClusters}
              />
            ))}
          </div>
        </section>
      )}

      <IgnoredFacesSection onRestored={fetchClusters} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ignored faces section (collapsible, at page bottom)
// ---------------------------------------------------------------------------

function IgnoredFacesSection({ onRestored }: { onRestored: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const { data, refetch } = useFetch(
    () => api.ignoredFaces({ limit: 200 }),
    [],
  )

  useAutoRefresh(['feature'], refetch)

  const total = data?.total ?? 0
  if (total === 0) return null

  const handleUnignore = async (featureId: number) => {
    try {
      await api.unignoreFace(featureId)
      refetch()
      onRestored()
    } catch {
      // face stays in the ignored list — user can retry
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Ignored Faces ({total})
      </button>
      {expanded && data && (
        <div className="flex flex-wrap gap-2">
          {data.items.map((face) => (
            <div key={face.id} className="group relative">
              <div className="h-12 w-12 overflow-hidden rounded-lg bg-control opacity-50 ring-1 ring-border">
                <img
                  src={api.faceUrl(face.id)}
                  alt={`Ignored face ${face.id}`}
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => handleUnignore(face.id)}
                title="Restore this face"
                className="absolute -right-1 -top-1 hidden rounded-full bg-surface p-0.5 text-foreground-muted shadow-sm ring-1 ring-border transition-colors hover:bg-accent hover:text-accent-foreground group-hover:block"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TriageHeader({ total, totalFaces }: { total: number; totalFaces: number }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <Link
        to="/people"
        className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Face Triage</h1>
        {totalFaces > 0 && (
          <p className="text-sm text-foreground-muted">
            {total} cluster{total !== 1 ? 's' : ''} &middot; {totalFaces} face{totalFaces !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cluster card (multi-face)
// ---------------------------------------------------------------------------

function ClusterCard({
  cluster,
  onAssigned,
}: {
  cluster: FaceCluster
  onAssigned: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [naming, setNaming] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const topCandidate = cluster.candidates[0] as PersonCandidate | undefined
  const candidateName = topCandidate?.names.find((n) => n.preferred)?.name
    ?? topCandidate?.names[0]?.name

  const selectedFeatureIds = [...selected]
  const visibleFeatures = expanded ? cluster.features : cluster.features.slice(0, 8)
  const overflowCount = expanded ? 0 : Math.max(0, cluster.features.length - 8)

  useEffect(() => {
    if (naming) nameInputRef.current?.focus()
  }, [naming])

  const handleQuickAssign = async () => {
    if (!topCandidate || selectedFeatureIds.length === 0) return
    setBusy(true)
    try {
      await api.bulkAssignFaces(topCandidate.personId, selectedFeatureIds)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleCreatePerson = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed || selectedFeatureIds.length === 0) return
    setBusy(true)
    try {
      await api.bulkCreatePerson(trimmed, selectedFeatureIds)
      setNaming(false)
      setNameValue('')
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleAssignToPerson = async (personId: number) => {
    if (selectedFeatureIds.length === 0) return
    setBusy(true)
    try {
      await api.bulkAssignFaces(personId, selectedFeatureIds)
      setAssigning(false)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleIgnore = async (featureId: number) => {
    setBusy(true)
    try {
      await api.ignoreFace(featureId)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(featureId)
        return next
      })
      onAssigned()
    } catch {
      // face stays in the cluster — user can retry
    } finally {
      setBusy(false)
    }
  }

  const toggleSelect = (featureId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(featureId)) {
        next.delete(featureId)
      } else {
        next.add(featureId)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(cluster.featureIds))
  const selectNone = () => setSelected(new Set())

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-4">
        {/* Left face: candidate person if available, otherwise cluster representative */}
        {topCandidate?.firstFeature ? (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div className="h-20 w-20 overflow-hidden rounded-full bg-control ring-2 ring-accent">
              <img
                src={api.faceUrl(topCandidate.firstFeature.featureId)}
                alt={candidateName ?? 'Suggested person'}
                className="h-full w-full object-cover"
              />
            </div>
            <span className="max-w-[5rem] truncate text-xs font-medium text-accent">{candidateName}</span>
          </div>
        ) : (
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-control ring-2 ring-border">
            <img
              src={api.faceUrl(cluster.representativeFeatureId)}
              alt="Cluster representative"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Filmstrip */}
          <div className="mb-2 flex items-center gap-1.5">
            {visibleFeatures.slice(0, 8).map((f) => (
              <FaceThumbnail
                key={f.featureId}
                featureId={f.featureId}
                itemId={f.itemId}
                selected={selected.has(f.featureId)}
                onClick={() => toggleSelect(f.featureId)}
                onIgnore={handleIgnore}
              />
            ))}
            {overflowCount > 0 && (
              <span className="shrink-0 text-xs text-foreground-muted">+{overflowCount}</span>
            )}
          </div>

          {/* Badge + expand + selection controls */}
          <div className="flex items-center gap-2">
            <Badge>{cluster.size} face{cluster.size !== 1 ? 's' : ''}</Badge>
            {selected.size > 0 && (
              <Badge variant="accent">{selected.size} selected</Badge>
            )}
            <button
              type="button"
              onClick={selectAll}
              className="rounded px-1.5 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
            >
              All
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="rounded px-1.5 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
            >
              None
            </button>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Collapse' : 'Show all'}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {topCandidate && candidateName && (
            <button
              type="button"
              onClick={handleQuickAssign}
              disabled={busy || selectedFeatureIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {candidateName}
            </button>
          )}
          <IconButton
            label="Name this person"
            onClick={() => { setNaming(true); setAssigning(false) }}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Assign to existing person"
            onClick={() => { setAssigning(true); setNaming(false) }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Expanded face grid */}
      {expanded && cluster.features.length > 8 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {cluster.features.slice(8).map((f) => (
            <FaceThumbnail
              key={f.featureId}
              featureId={f.featureId}
              itemId={f.itemId}
              selected={selected.has(f.featureId)}
              onClick={() => toggleSelect(f.featureId)}
              onIgnore={handleIgnore}
            />
          ))}
        </div>
      )}

      {/* Inline name input */}
      {naming && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleCreatePerson() }}
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
        >
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="Enter person's name"
            className="flex-1 rounded-lg border border-border bg-control px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !nameValue.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
          <IconButton label="Cancel" onClick={() => { setNaming(false); setNameValue('') }}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </form>
      )}

      {/* Assign to person modal */}
      {assigning && (
        <TriageAssignModal
          onClose={() => setAssigning(false)}
          onSelect={handleAssignToPerson}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirmation card (single-face clusters)
// ---------------------------------------------------------------------------

function ConfirmationCard({
  cluster,
  onAssigned,
}: {
  cluster: FaceCluster
  onAssigned: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const featureId = cluster.featureIds[0]!
  const itemId = cluster.features[0]?.itemId

  const topCandidate = cluster.candidates[0] as PersonCandidate | undefined
  const candidateName = topCandidate?.names.find((n) => n.preferred)?.name
    ?? topCandidate?.names[0]?.name

  useEffect(() => {
    if (naming) nameInputRef.current?.focus()
  }, [naming])

  useEffect(() => {
    if (!topCandidate || naming || assigning) return

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'y' || e.key === 'Y') {
        handleConfirm()
      } else if (e.key === 'n' || e.key === 'N') {
        handleDeny()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const handleConfirm = async () => {
    if (!topCandidate) return
    setBusy(true)
    try {
      await api.bulkAssignFaces(topCandidate.personId, [featureId])
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleDeny = async () => {
    if (!topCandidate?.firstFeature) return
    setBusy(true)
    try {
      await api.ignoreMatch(featureId, topCandidate.firstFeature.featureId)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleCreatePerson = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await api.bulkCreatePerson(trimmed, [featureId])
      setNaming(false)
      setNameValue('')
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleAssignToPerson = async (personId: number) => {
    setBusy(true)
    try {
      await api.bulkAssignFaces(personId, [featureId])
      setAssigning(false)
      onAssigned()
    } finally {
      setBusy(false)
    }
  }

  const handleIgnore = async () => {
    setBusy(true)
    try {
      await api.ignoreFace(featureId)
      onAssigned()
    } catch {
      // face stays in the card — user can retry
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={cardRef} className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-4">
        {/* Unlinked face */}
        <div className="group relative shrink-0">
          <div className="h-16 w-16 overflow-hidden rounded-full bg-control ring-2 ring-border">
            <img
              src={api.faceUrl(featureId)}
              alt="Unlinked face"
              className="h-full w-full object-cover"
            />
          </div>
          {itemId != null && (
            <button
              type="button"
              onClick={() => setShowContext(true)}
              className="absolute -right-0.5 -top-0.5 rounded-full bg-surface/90 p-0.5 text-foreground-muted/40 shadow-sm ring-1 ring-border transition-colors hover:bg-surface hover:text-foreground group-hover:text-foreground-muted"
            >
              <Eye className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={handleIgnore}
            disabled={busy}
            title="Ignore this face"
            className="absolute -left-0.5 -top-0.5 hidden rounded-full bg-surface/90 p-0.5 text-foreground-muted/40 shadow-sm ring-1 ring-border transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:opacity-40 group-hover:block group-hover:text-foreground-muted"
          >
            <Ban className="h-3 w-3" />
          </button>
        </div>

        {topCandidate && candidateName ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Candidate person face */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">→</span>
              {topCandidate.firstFeature && (
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-control">
                  <img
                    src={api.faceUrl(topCandidate.firstFeature.featureId)}
                    alt={candidateName}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{candidateName}</p>
                <p className="text-xs text-foreground-muted">
                  {topCandidate.photoCount} photo{topCandidate.photoCount !== 1 ? 's' : ''} &middot; score {typeof topCandidate.matchScore === 'number' ? topCandidate.matchScore.toFixed(2) : topCandidate.matchScore}
                </p>
              </div>
            </div>

            {/* Yes/No buttons */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Yes
                <kbd className="ml-1 rounded border border-accent-foreground/20 px-1 py-0.5 text-[10px]">Y</kbd>
              </button>
              <button
                type="button"
                onClick={handleDeny}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-control disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
                No
                <kbd className="ml-1 rounded border border-border px-1 py-0.5 text-[10px]">N</kbd>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-sm text-foreground-muted">No match suggestions</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconButton
                label="Name this person"
                onClick={() => { setNaming(true); setAssigning(false) }}
              >
                <UserPlus className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Assign to existing person"
                onClick={() => { setAssigning(true); setNaming(false) }}
              >
                <Link2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        )}
      </div>

      {/* Inline name input */}
      {naming && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleCreatePerson() }}
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
        >
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="Enter person's name"
            className="flex-1 rounded-lg border border-border bg-control px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !nameValue.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
          <IconButton label="Cancel" onClick={() => { setNaming(false); setNameValue('') }}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </form>
      )}

      {/* Assign to person modal */}
      {assigning && (
        <TriageAssignModal
          onClose={() => setAssigning(false)}
          onSelect={handleAssignToPerson}
        />
      )}

      {/* Face context popover */}
      {showContext && itemId != null && (
        <FaceContextPopover
          featureId={featureId}
          itemId={itemId}
          onClose={() => setShowContext(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Face thumbnail with context popover trigger
// ---------------------------------------------------------------------------

function FaceThumbnail({
  featureId,
  itemId,
  selected,
  onClick,
  onIgnore,
}: {
  featureId: number
  itemId: number
  selected: boolean
  onClick: () => void
  onIgnore?: (featureId: number) => void
}) {
  const [showContext, setShowContext] = useState(false)

  return (
    <>
      <div className="group relative">
        <button
          type="button"
          onClick={onClick}
          className={`h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-control transition-all cursor-pointer hover:ring-2 hover:ring-accent ${
            selected ? 'ring-2 ring-accent' : 'opacity-50'
          }`}
        >
          <img
            src={api.faceUrl(featureId)}
            alt={`Face ${featureId}`}
            className="h-full w-full object-cover"
          />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowContext(true) }}
          className="absolute -right-0.5 -top-0.5 rounded-full bg-surface/90 p-0.5 text-foreground-muted/40 shadow-sm ring-1 ring-border transition-colors hover:bg-surface hover:text-foreground group-hover:text-foreground-muted"
        >
          <Eye className="h-3 w-3" />
        </button>
        {onIgnore && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIgnore(featureId) }}
            title="Ignore this face"
            className="absolute -left-0.5 -top-0.5 hidden rounded-full bg-surface/90 p-0.5 text-foreground-muted/40 shadow-sm ring-1 ring-border transition-colors hover:bg-red-500/20 hover:text-red-400 group-hover:block group-hover:text-foreground-muted"
          >
            <Ban className="h-3 w-3" />
          </button>
        )}
      </div>
      {showContext && (
        <FaceContextPopover
          featureId={featureId}
          itemId={itemId}
          onClose={() => setShowContext(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Face-in-context popover
// ---------------------------------------------------------------------------

function FaceContextPopover({
  featureId,
  itemId,
  onClose,
}: {
  featureId: number
  itemId: number
  onClose: () => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const { data: mediaItem, isLoading } = useFetch(
    () => api.mediaItem(itemId),
    [itemId],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const formattedDate = mediaItem?.startDate
    ? new Date(mediaItem.startDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    : null

  return (
    <div
      ref={backdropRef}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="truncate text-sm font-medium">
            {isLoading ? 'Loading…' : (mediaItem?.name ?? 'Source Photo')}
          </h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto bg-black">
          <img
            src={api.imageUrl(itemId, 640)}
            alt={mediaItem?.name ?? 'Source photo'}
            className="h-auto w-full object-contain"
          />
          <div className="absolute bottom-3 left-3">
            <div className="h-14 w-14 overflow-hidden rounded-full bg-control ring-2 ring-white/50">
              <img
                src={api.faceUrl(featureId)}
                alt="Face"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>

        {(formattedDate || mediaItem?.folderPath) && (
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-xs text-foreground-muted">
              {[formattedDate, mediaItem?.folderPath].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assign to person modal (replicates PersonSearchList + ModalBackdrop pattern)
// ---------------------------------------------------------------------------

function TriageAssignModal({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (personId: number) => void
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={backdropRef}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">Assign to Person</h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-4">
          <PersonSearchList onSelect={(personId) => { onSelect(personId); onClose() }} />
        </div>
      </div>
    </div>
  )
}

function PersonSearchList({
  onSelect,
}: {
  onSelect: (personId: number) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonBatchItem[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const versionRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const search = useCallback(
    (q: string) => {
      const version = ++versionRef.current
      setLoading(true)
      api
        .peopleSearch(q, 200)
        .then((res) => {
          if (version !== versionRef.current) return
          setResults(res.items)
          setLoading(false)
        })
        .catch(() => {
          if (version !== versionRef.current) return
          setResults([])
          setLoading(false)
        })
    },
    [],
  )

  useEffect(() => {
    search('')
  }, [search])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 200)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search people…"
          className="w-full rounded-lg border border-border bg-control py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-4 text-center text-sm text-foreground-muted">No people found</p>
        ) : (
          <div className="space-y-1">
            {results.map((item) => {
              const name =
                item.names.find((n) => n.preferred)?.name ??
                item.names[0]?.name ??
                `Person ${item.personId}`
              return (
                <button
                  key={item.personId}
                  type="button"
                  onClick={() => onSelect(item.personId)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-control"
                >
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-raised">
                    {item.firstFeature ? (
                      <img
                        src={api.faceUrl(item.firstFeature.featureId)}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground-faint">
                        {name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-foreground-muted">
                      {item.photoCount} photo{item.photoCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
