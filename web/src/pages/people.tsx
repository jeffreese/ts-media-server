import { Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type Person, type PersonBatchItem, api } from '~/lib/api'

const PAGE_SIZE = 60

export function PeoplePage() {
  const navigate = useNavigate()

  const fetcher = useCallback(
    (offset: number, limit: number) => api.people({ offset, limit }),
    [],
  )

  const { items, total, isLoading, isLoadingMore, error, hasMore, sentinelRef, refetch } =
    useInfiniteScroll<Person>({ fetcher, pageSize: PAGE_SIZE })

  useAutoRefresh(['person', 'personName', 'feature', 'personFeature'], refetch)

  const [batchData, setBatchData] = useState<Map<number, PersonBatchItem>>(new Map())
  const pendingIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const newIds = items
      .map((p) => p.id)
      .filter((id) => !batchData.has(id) && !pendingIdsRef.current.has(id))

    if (newIds.length === 0) return

    for (const id of newIds) pendingIdsRef.current.add(id)

    api.peopleBatch(newIds).then((res) => {
      setBatchData((prev) => {
        const next = new Map(prev)
        for (const item of res.items) {
          next.set(item.personId, item)
        }
        return next
      })
      for (const id of newIds) pendingIdsRef.current.delete(id)
    }).catch(() => {
      for (const id of newIds) pendingIdsRef.current.delete(id)
    })
  }, [items, batchData])

  if (error) {
    return <FetchError message={`Failed to load people: ${error.message}`} onRetry={refetch} />
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-xl font-semibold">People</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square rounded-full" />
              <Skeleton className="mx-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-12 w-12" />}
        title="No people found"
        description="People are detected automatically when media is indexed. Add a directory with photos to get started."
      />
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">
        People <span className="text-foreground-muted font-normal">({total})</span>
      </h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((person) => {
          const batch = batchData.get(person.id)
          return (
            <BatchPersonCard
              key={person.id}
              person={person}
              batch={batch}
              onClick={() => navigate(`/people/${person.id}`)}
            />
          )
        })}
      </div>
      <LoadMoreSentinel
        sentinelRef={sentinelRef}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
      />
    </div>
  )
}

function BatchPersonCard({
  person,
  batch,
  onClick,
}: {
  person: Person
  batch: PersonBatchItem | undefined
  onClick: () => void
}) {
  const displayName = batch
    ? (batch.names.find((n) => n.preferred)?.name ?? batch.names[0]?.name ?? `Person ${person.id}`)
    : `Person ${person.id}`

  const featureId = batch?.firstFeature?.featureId

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl p-3 transition-colors hover:bg-surface-raised"
    >
      <div className="aspect-square w-full max-w-[120px] overflow-hidden rounded-full bg-control">
        {featureId ? (
          <img
            src={api.faceUrl(featureId)}
            alt={displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-foreground-faint">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className="text-sm font-medium text-foreground truncate w-full text-center">
        {displayName}
      </span>
      {batch && batch.photoCount > 0 && (
        <span className="text-xs text-foreground-muted">
          {batch.photoCount} photo{batch.photoCount !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  )
}
