import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  DuplicatesSection,
  FacesSection,
  KeywordsSection,
  MetadataPanel,
  RatingSection,
  ThumbnailsSection,
} from '~/components/media-detail'
import { Badge, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

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
  const { data: item, isLoading, error } = useFetch(() => api.mediaItem(id), [id])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !item) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  const isVideo = item.type === 'video'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Browse
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{item.name ?? `Media Item ${item.id}`}</h1>
          {item.description && (
            <p className="text-sm text-foreground-secondary">{item.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.type && <Badge>{item.type}</Badge>}
          {item.hash && (
            <Badge variant="accent">
              <span className="font-mono text-[10px]">{item.hash.slice(0, 8)}</span>
            </Badge>
          )}
        </div>
      </div>

      {/* Media preview */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isVideo ? (
          <video
            src={api.videoUrl(item.id)}
            controls
            className="w-full"
            poster={api.imageUrl(item.id, 1920)}
          >
            <track kind="captions" />
          </video>
        ) : (
          <img
            src={api.imageUrl(item.id, 1920)}
            alt={item.name ?? `Media ${item.id}`}
            className="w-full"
          />
        )}
      </div>

      {/* Two-column detail layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: metadata, faces, duplicates */}
        <div className="space-y-6">
          <MetadataPanel info={item.info} startDate={item.startDate} endDate={item.endDate} />
          <FacesSection mediaItemId={item.id} />
          <DuplicatesSection mediaItemId={item.id} />
        </div>

        {/* Right: keywords, rating, thumbnails */}
        <div className="space-y-6">
          <RatingSection mediaItemId={item.id} />
          <KeywordsSection mediaItemId={item.id} />
          <ThumbnailsSection mediaItemId={item.id} />
        </div>
      </div>
    </div>
  )
}
