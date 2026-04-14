import { Folder } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { MediaGrid } from '~/components/media-grid'
import { Skeleton } from '~/components/primitives'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type FolderEntry, type IndexResponse, api } from '~/lib/api'

const PAGE_SIZE = 60

export function BrowsePage() {
  const params = useParams()
  const navigate = useNavigate()
  const path = params['*'] ?? ''

  const fetcher = useCallback(
    (offset: number, limit: number) =>
      api.index(path, { offset, limit }) as Promise<IndexResponse & { items: IndexResponse['items']; total: number }>,
    [path],
  )

  const { items: allEntries, total, isLoading, isLoadingMore, error, hasMore, sentinelRef } =
    useInfiniteScroll({
      fetcher: useCallback(
        async (offset: number, limit: number) => {
          const res = await fetcher(offset, limit)
          const combined = [
            ...res.folders.map((f) => ({ kind: 'folder' as const, ...f })),
            ...res.items.map((i) => ({ kind: 'item' as const, ...i })),
          ]
          return { items: combined, offset: res.offset, limit: res.limit, total: res.total }
        },
        [fetcher],
      ),
      pageSize: PAGE_SIZE,
      deps: [path],
    })

  const folders = useMemo(
    () => allEntries.filter((e): e is Extract<typeof e, { kind: 'folder' }> => e.kind === 'folder'),
    [allEntries],
  )
  const items = useMemo(
    () => allEntries.filter((e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item'),
    [allEntries],
  )

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load: {error.message}</p>
      </div>
    )
  }

  if (isLoading) {
    return <BrowseSkeleton />
  }

  const hasContent = folders.length > 0 || items.length > 0

  return (
    <div className="space-y-6">
      {folders.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
            Folders
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {folders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onClick={() => {
                  const next = path ? `${path}/${folder.name}` : folder.name
                  navigate(`/browse/${next}`)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
            {total - folders.length} item{total - folders.length !== 1 ? 's' : ''}
          </h2>
          <MediaGrid items={items} />
          <LoadMoreSentinel
            sentinelRef={sentinelRef}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            variant="grid"
          />
        </section>
      )}

      {!hasContent && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">This folder is empty</p>
        </div>
      )}
    </div>
  )
}

function FolderCard({ folder, onClick }: { folder: FolderEntry; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent hover:bg-surface-raised"
    >
      <Folder className="h-8 w-8 text-accent" />
      <span className="text-sm font-medium text-foreground truncate w-full text-center">
        {folder.name}
      </span>
    </button>
  )
}

function BrowseSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
