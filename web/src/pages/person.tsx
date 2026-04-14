import { ArrowLeft } from 'lucide-react'
import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { IconButton, Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useBreadcrumb } from '~/hooks/use-breadcrumb'
import { useFetch } from '~/hooks/use-fetch'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { api } from '~/lib/api'

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
      </div>

      {/* Face thumbnails */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
          Faces
          {!featuresLoading && featuresTotal > 0 && (
            <span className="ml-2 font-normal">({featuresTotal})</span>
          )}
        </h2>
        {featuresLoading ? (
          <div className="flex gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-20 rounded-full" />
            ))}
          </div>
        ) : features.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {features.map((feat) => (
              <button
                type="button"
                key={feat.id}
                onClick={() => navigate(`/media/${feat.itemId}`)}
                className="h-20 w-20 overflow-hidden rounded-full bg-control transition-transform hover:scale-105"
              >
                <img
                  src={api.faceUrl(feat.featureId)}
                  alt={`Face ${feat.featureId}`}
                  className="h-full w-full object-cover"
                />
              </button>
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
    </div>
  )
}
