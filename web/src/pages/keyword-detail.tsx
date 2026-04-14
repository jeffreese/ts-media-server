import { ArrowLeft, Tag } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { MediaGrid } from '~/components/media-grid'
import { Skeleton } from '~/components/primitives'
import { useBreadcrumb } from '~/hooks/use-breadcrumb'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type KeywordItemsResponse, type MediaItemEntry, api } from '~/lib/api'

const PAGE_SIZE = 60

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
  const [keywordWord, setKeywordWord] = useState<string | undefined>(undefined)

  useBreadcrumb(String(id), keywordWord)

  const fetcher = useCallback(
    async (offset: number, limit: number) => {
      const res: KeywordItemsResponse = await api.keywordItems(id, { offset, limit })
      if (offset === 0) {
        setKeywordWord(res.keyword.word)
      }
      return { items: res.items, offset: res.offset, limit: res.limit, total: res.total }
    },
    [id],
  )

  const { items: rawItems, total, isLoading, isLoadingMore, error, hasMore, sentinelRef, refetch } =
    useInfiniteScroll({
      fetcher,
      pageSize: PAGE_SIZE,
      deps: [id],
    })

  const items: MediaItemEntry[] = useMemo(
    () => rawItems.map((r) => ({ ...r, folderEntryIndex: null })),
    [rawItems],
  )

  if (error) {
    return <FetchError message={`Failed to load: ${error.message}`} onRetry={refetch} />
  }

  if (isLoading) {
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
        <h1 className="text-xl font-semibold">{keywordWord}</h1>
        <span className="text-sm text-foreground-muted">
          {total} item{total !== 1 ? 's' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-10 w-10" />}
          title="No media items tagged with this keyword"
        />
      ) : (
        <>
          <MediaGrid items={items} />
          <LoadMoreSentinel
            sentinelRef={sentinelRef}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            variant="grid"
          />
        </>
      )}
    </div>
  )
}
