import { ArrowLeft, Check, GitMerge, Pencil, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { PersonSearchList } from '~/components/person-search-list'
import { IconButton, Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useBreadcrumb } from '~/hooks/use-breadcrumb'
import { useFetch } from '~/hooks/use-fetch'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type PersonFeature, api } from '~/lib/api'

const PAGE_SIZE = 60

export function PersonPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const personId = Number(id)

  if (!id || Number.isNaN(personId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Invalid person ID</p>
      </div>
    )
  }

  return <PersonContent personId={personId} navigate={navigate} />
}

function PersonContent({
  personId,
  navigate,
}: {
  personId: number
  navigate: ReturnType<typeof useNavigate>
}) {
  const { data: names, isLoading: namesLoading, error: namesError, refetch: refetchNames } = useFetch(
    () => api.personNames(personId),
    [personId],
  )

  const featureFetcher = useCallback(
    (offset: number, limit: number) => api.personFeatures(personId, { offset, limit }),
    [personId],
  )

  const {
    items: features,
    total: featuresTotal,
    isLoading: featuresLoading,
    isLoadingMore,
    hasMore,
    sentinelRef,
    error: featuresError,
    refetch: refetchFeatures,
  } = useInfiniteScroll({
    fetcher: featureFetcher,
    pageSize: PAGE_SIZE,
    deps: [personId],
  })

  useAutoRefresh(['person', 'personName', 'feature', 'personFeature'], refetchFeatures)

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [removing, setRemoving] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [merging, setMerging] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function toggleSelect(personFeatureId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(personFeatureId)) {
        next.delete(personFeatureId)
      } else {
        next.add(personFeatureId)
      }
      return next
    })
  }

  function exitSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  async function removeSelected() {
    if (selected.size === 0) return
    setRemoving(true)
    try {
      await api.unlinkFeaturesFromPerson(personId, [...selected])
      exitSelecting()
      refetchFeatures()
    } catch {
      // stay in selection mode so user can retry
    } finally {
      setRemoving(false)
    }
  }

  async function handleMerge(targetPersonId: number) {
    setMerging(true)
    try {
      await api.mergePerson(targetPersonId, personId)
      setShowMergeModal(false)
      navigate(`/people/${targetPersonId}`)
    } catch {
      setMerging(false)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${displayName}"? This will remove the person and unlink all associated faces.`,
    )
    if (!confirmed) return

    setDeleting(true)
    try {
      await api.deletePerson(personId)
      navigate('/people')
    } catch {
      setDeleting(false)
    }
  }

  const error = namesError || featuresError
  if (error) {
    return (
      <FetchError
        message={`Failed to load person: ${error.message}`}
        onRetry={namesError ? refetchNames : refetchFeatures}
      />
    )
  }

  const isLoading = namesLoading || featuresLoading
  const displayName =
    names?.items.find((n) => n.preferred)?.name ?? names?.items[0]?.name ?? `Person ${personId}`

  useBreadcrumb(String(personId), namesLoading ? undefined : displayName)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Back to people" onClick={() => navigate('/people')}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        {isLoading ? (
          <Skeleton className="h-7 w-40" />
        ) : (
          <h1 className="text-xl font-semibold">{displayName}</h1>
        )}
        {!isLoading && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowMergeModal(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <GitMerge className="h-3.5 w-3.5" />
              Merge into…
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {/* Face thumbnails */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground-muted uppercase tracking-wider">
            Faces
            {!featuresLoading && featuresTotal > 0 && (
              <span className="ml-2 font-normal">({featuresTotal})</span>
            )}
          </h2>
          {!featuresLoading && features.length > 0 && !selecting && (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>

        {selecting && (
          <SelectionToolbar
            count={selected.size}
            total={features.length}
            removing={removing}
            onSelectAll={() => setSelected(new Set(features.map((f) => f.id)))}
            onDeselectAll={() => setSelected(new Set())}
            onRemove={removeSelected}
            onCancel={exitSelecting}
          />
        )}

        {featuresLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-20 rounded-full" />
            ))}
          </div>
        ) : features.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {features.map((feat) => (
              <FaceThumbnail
                key={feat.id}
                feat={feat}
                selecting={selecting}
                isSelected={selected.has(feat.id)}
                onToggle={() => toggleSelect(feat.id)}
                onNavigate={() => navigate(`/media/${feat.itemId}`)}
              />
            ))}
          </div>
        ) : (
          <p className="text-foreground-muted text-sm">No faces linked</p>
        )}
      </section>

      {/* Media items with this person's face */}
      {features.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
            Photos
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {features.map((feat) => (
              <button
                type="button"
                key={feat.id}
                onClick={() => navigate(`/media/${feat.itemId}`)}
                className="media-thumb aspect-square overflow-hidden rounded-lg bg-control"
              >
                <img
                  src={api.imageUrl(feat.itemId, 300)}
                  alt={`Photo containing ${displayName}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
          <LoadMoreSentinel
            sentinelRef={sentinelRef}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            variant="grid"
          />
        </section>
      )}

      {showMergeModal && (
        <MergePersonModal
          personId={personId}
          displayName={displayName}
          merging={merging}
          onSelect={handleMerge}
          onClose={() => setShowMergeModal(false)}
        />
      )}
    </div>
  )
}

function SelectionToolbar({
  count,
  total,
  removing,
  onSelectAll,
  onDeselectAll,
  onRemove,
  onCancel,
}: {
  count: number
  total: number
  removing: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onRemove: () => void
  onCancel: () => void
}) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
      <span className="text-sm font-medium">
        {count} selected
      </span>
      <button
        type="button"
        onClick={count === total ? onDeselectAll : onSelectAll}
        className="text-xs font-medium text-accent hover:text-accent/80"
      >
        {count === total ? 'Deselect all' : 'Select all'}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onRemove}
        disabled={count === 0 || removing}
        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {removing ? 'Removing…' : 'Remove'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={removing}
        className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function FaceThumbnail({
  feat,
  selecting,
  isSelected,
  onToggle,
  onNavigate,
}: {
  feat: PersonFeature
  selecting: boolean
  isSelected: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  return (
    <button
      type="button"
      onClick={selecting ? onToggle : onNavigate}
      className={`relative h-20 w-20 overflow-hidden rounded-full bg-control transition-transform hover:scale-105 ${
        selecting && isSelected ? 'ring-2 ring-accent ring-offset-2 ring-offset-background' : ''
      }`}
    >
      <img
        src={api.faceUrl(feat.featureId)}
        alt={`Face ${feat.featureId}`}
        className={`h-full w-full object-cover ${selecting && isSelected ? 'brightness-75' : ''}`}
      />
      {selecting && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${
            isSelected ? 'bg-accent/30' : 'bg-black/10'
          }`}
        >
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
              isSelected
                ? 'border-accent bg-accent text-white'
                : 'border-white/70 bg-black/20'
            }`}
          >
            {isSelected && <Check className="h-3.5 w-3.5" />}
          </div>
        </div>
      )}
    </button>
  )
}

function MergePersonModal({
  personId,
  displayName,
  merging,
  onSelect,
  onClose,
}: {
  personId: number
  displayName: string
  merging: boolean
  onSelect: (targetPersonId: number) => void
  onClose: () => void
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
          <h3 className="text-sm font-medium">
            Merge "{displayName}" into…
          </h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-4">
          <p className="mb-3 text-xs text-foreground-muted">
            All face links and names will be transferred to the selected person. "{displayName}" will be deleted.
          </p>
          {merging ? (
            <div className="flex justify-center py-8">
              <Skeleton className="h-6 w-32" />
            </div>
          ) : (
            <PersonSearchList
              onSelect={onSelect}
              excludePersonIds={[personId]}
            />
          )}
        </div>
      </div>
    </div>
  )
}
