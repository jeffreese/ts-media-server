import { ArrowLeft, Tag } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MediaGrid } from '~/components/media-grid'
import { Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { type MediaItemEntry, api } from '~/lib/api'

export function KeywordDetailPage() {
  const { id } = useParams<{ id: string }>()
  const numericId = Number(id)

  if (!id || Number.isNaN(numericId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Invalid keyword ID</p>
      </div>
    )
  }

  return <KeywordDetailContent id={numericId} />
}

function KeywordDetailContent({ id }: { id: number }) {
  const { data, isLoading, error } = useFetch(
    () => api.keywordItems(id, { limit: 200 }),
    [id],
  )

  const items: MediaItemEntry[] = useMemo(
    () =>
      data?.items.map((r) => ({
        ...r,
        folderEntryIndex: null,
      })) ?? [],
    [data],
  )

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to="/keywords"
        className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Keywords
      </Link>

      <div className="flex items-center gap-3">
        <Tag className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-semibold">{data.keyword.word}</h1>
        <span className="text-sm text-foreground-muted">
          {data.total} item{data.total !== 1 ? 's' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">No media items tagged with this keyword</p>
        </div>
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  )
}
