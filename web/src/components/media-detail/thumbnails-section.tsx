import { SectionCard, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

interface ThumbnailsSectionProps {
  mediaItemId: number
}

export function ThumbnailsSection({ mediaItemId }: ThumbnailsSectionProps) {
  const { data, isLoading } = useFetch(() => api.thumbnailWidths(mediaItemId), [mediaItemId])

  if (isLoading) {
    return (
      <SectionCard title="Thumbnails">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-14 rounded-md" />
          <Skeleton className="h-5 w-14 rounded-md" />
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
      </SectionCard>
    )
  }

  const widths = data?.widths ?? []
  if (widths.length === 0) return null

  const sorted = [...widths].sort((a, b) => a - b)

  return (
    <SectionCard title={`Thumbnails (${sorted.length})`}>
      <div className="flex flex-wrap gap-2">
        {sorted.map((w) => (
          <a
            key={w}
            href={api.imageUrl(mediaItemId, w)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-control px-2.5 py-1 text-xs font-medium text-foreground-secondary transition-colors hover:bg-control-hover hover:text-foreground"
          >
            {w}px
          </a>
        ))}
      </div>
    </SectionCard>
  )
}
