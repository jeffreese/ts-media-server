import { Filter, Image, Film, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MediaGrid } from '~/components/media-grid'
import { Badge, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { type MediaItemEntry, type SearchFilters, api } from '~/lib/api'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const keyword = searchParams.get('keyword') ?? ''
  const type = (searchParams.get('type') as 'image' | 'video' | undefined) ?? undefined
  const dateStart = searchParams.get('dateStart') ?? ''
  const dateEnd = searchParams.get('dateEnd') ?? ''

  const [showFilters, setShowFilters] = useState(
    Boolean(type || dateStart || dateEnd),
  )

  const filters: SearchFilters = useMemo(
    () => ({
      q: q || undefined,
      keyword: keyword || undefined,
      type,
      dateStart: dateStart || undefined,
      dateEnd: dateEnd || undefined,
    }),
    [q, keyword, type, dateStart, dateEnd],
  )

  const hasAnyFilter = Boolean(q || keyword || type || dateStart || dateEnd)

  const { data, isLoading, error } = useFetch(
    () => (hasAnyFilter ? api.search({ ...filters, limit: 200 }) : Promise.resolve(null)),
    [q, keyword, type, dateStart, dateEnd],
  )

  const updateParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      })
    },
    [setSearchParams],
  )

  const clearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams()
      const qVal = prev.get('q')
      if (qVal) next.set('q', qVal)
      return next
    })
  }, [setSearchParams])

  const items: MediaItemEntry[] = useMemo(
    () =>
      data?.items.map((r) => ({
        ...r,
        folderEntryIndex: null,
      })) ?? [],
    [data],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">
            {keyword ? `Keyword: ${keyword}` : q ? `Search: ${q}` : 'Search'}
          </h1>
          {data && (
            <p className="text-sm text-foreground-muted">
              {data.total} result{data.total !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            showFilters
              ? 'bg-accent-surface text-accent'
              : 'text-foreground-muted hover:bg-control hover:text-foreground'
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="space-y-1">
            <label htmlFor="filter-type" className="block text-xs font-medium text-foreground-muted">
              Type
            </label>
            <select
              id="filter-type"
              value={type ?? ''}
              onChange={(e) => updateParam('type', e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="">All</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="filter-dateStart" className="block text-xs font-medium text-foreground-muted">
              From
            </label>
            <input
              id="filter-dateStart"
              type="date"
              value={dateStart}
              onChange={(e) => updateParam('dateStart', e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="filter-dateEnd" className="block text-xs font-medium text-foreground-muted">
              To
            </label>
            <input
              id="filter-dateEnd"
              type="date"
              value={dateEnd}
              onChange={(e) => updateParam('dateEnd', e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>

          {(type || dateStart || dateEnd) && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Active filter badges */}
      {hasAnyFilter && (
        <div className="flex flex-wrap gap-2">
          {q && <Badge variant="accent">name: {q}</Badge>}
          {keyword && <Badge variant="accent">keyword: {keyword}</Badge>}
          {type && (
            <Badge variant="accent">
              {type === 'image' ? <Image className="mr-1 h-3 w-3" /> : <Film className="mr-1 h-3 w-3" />}
              {type}
            </Badge>
          )}
          {dateStart && <Badge variant="accent">from: {dateStart}</Badge>}
          {dateEnd && <Badge variant="accent">to: {dateEnd}</Badge>}
        </div>
      )}

      {!hasAnyFilter && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">
            Enter a search term or apply filters to find media
          </p>
        </div>
      )}

      {hasAnyFilter && error && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">Failed to search: {error.message}</p>
        </div>
      )}

      {hasAnyFilter && isLoading && <SearchSkeleton />}

      {hasAnyFilter && data && items.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">No results found</p>
        </div>
      )}

      {items.length > 0 && <MediaGrid items={items} />}
    </div>
  )
}

function SearchSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  )
}
