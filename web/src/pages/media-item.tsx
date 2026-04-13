import { useParams } from 'react-router-dom'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'
import { Skeleton, Badge } from '~/components/primitives'

export function MediaItemPage() {
  const { id } = useParams<{ id: string }>()
  const numericId = Number(id)

  if (!id || Number.isNaN(numericId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Invalid media item ID</p>
      </div>
    )
  }

  return <MediaItemContent id={numericId} />
}

function MediaItemContent({ id }: { id: number }) {
  const { data: item, isLoading, error } = useFetch(
    () => api.mediaItem(id),
    [id],
  )

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !item) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }

  const isVideo = item.type === 'video'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="overflow-hidden rounded-xl bg-surface border border-border">
        {isVideo ? (
          <video
            src={api.videoUrl(item.id)}
            controls
            className="w-full"
            poster={api.imageUrl(item.id, 1920)}
          />
        ) : (
          <img
            src={api.imageUrl(item.id, 1920)}
            alt={item.name ?? `Media ${item.id}`}
            className="w-full"
          />
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{item.name ?? `Media Item ${item.id}`}</h1>
          {item.type && <Badge>{item.type}</Badge>}
        </div>

        {item.description && (
          <p className="text-foreground-secondary">{item.description}</p>
        )}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {item.startDate && (
            <div>
              <dt className="text-foreground-muted">Date</dt>
              <dd>{item.startDate}</dd>
            </div>
          )}
          {item.hash && (
            <div>
              <dt className="text-foreground-muted">Hash</dt>
              <dd className="font-mono text-xs truncate">{item.hash}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
