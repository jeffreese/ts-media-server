import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { Skeleton } from '~/components/primitives'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type Place, type PlaceBatchItem, api } from '~/lib/api'

const PAGE_SIZE = 60

export function PlacesPage() {
  const navigate = useNavigate()

  const fetcher = useCallback((offset: number, limit: number) => api.places({ offset, limit }), [])

  const { items, total, isLoading, isLoadingMore, error, hasMore, sentinelRef, refetch } =
    useInfiniteScroll<Place>({ fetcher, pageSize: PAGE_SIZE })

  const [batchData, setBatchData] = useState<Map<number, PlaceBatchItem>>(new Map())
  const pendingIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const newIds = items
      .map((p) => p.id)
      .filter((id) => !batchData.has(id) && !pendingIdsRef.current.has(id))

    if (newIds.length === 0) return

    for (const id of newIds) pendingIdsRef.current.add(id)

    api
      .placesBatch(newIds)
      .then((res) => {
        setBatchData((prev) => {
          const next = new Map(prev)
          for (const item of res.items) {
            next.set(item.placeId, item)
          }
          return next
        })
        for (const id of newIds) pendingIdsRef.current.delete(id)
      })
      .catch(() => {
        for (const id of newIds) pendingIdsRef.current.delete(id)
      })
  }, [items, batchData])

  if (error) {
    return <FetchError message={`Failed to load places: ${error.message}`} onRetry={refetch} />
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-xl font-semibold">Places</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder skeletons
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="h-12 w-12" />}
        title="No places found"
        description="Link media items to places from the media detail page, or browse the map to see GPS-tagged photos."
      />
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">
        Places <span className="text-foreground-muted font-normal">({total})</span>
      </h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((place) => {
          const batch = batchData.get(place.id)
          return (
            <PlaceCard
              key={place.id}
              place={place}
              batch={batch}
              onClick={() => navigate(`/places/${place.id}`)}
            />
          )
        })}
      </div>
      <LoadMoreSentinel sentinelRef={sentinelRef} isLoadingMore={isLoadingMore} hasMore={hasMore} />
    </div>
  )
}

function PlaceCard({
  place,
  batch,
  onClick,
}: {
  place: Place
  batch: PlaceBatchItem | undefined
  onClick: () => void
}) {
  const displayName = batch
    ? (batch.names.find((n) => n.preferred)?.name ?? batch.names[0]?.name ?? `Place ${place.id}`)
    : `Place ${place.id}`

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-raised"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent-surface">
        <MapPin className="h-5 w-5 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
        {batch && (
          <p className="text-xs text-foreground-muted">
            {batch.mediaCount} photo{batch.mediaCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </button>
  )
}
