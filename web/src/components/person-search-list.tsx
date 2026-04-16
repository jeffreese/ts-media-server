import { Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton } from '~/components/primitives'
import { type PersonBatchItem, api } from '~/lib/api'

export function PersonSearchList({
  onSelect,
  excludePersonIds,
}: {
  onSelect: (personId: number) => void
  excludePersonIds?: number[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonBatchItem[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const versionRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const excludeSet = excludePersonIds ? new Set(excludePersonIds) : null

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const search = useCallback(
    (q: string) => {
      const version = ++versionRef.current
      setLoading(true)
      api
        .peopleSearch(q, 200)
        .then((res) => {
          if (version !== versionRef.current) return
          setResults(res.items)
          setLoading(false)
        })
        .catch(() => {
          if (version !== versionRef.current) return
          setResults([])
          setLoading(false)
        })
    },
    [],
  )

  useEffect(() => {
    search('')
  }, [search])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 200)
  }

  const filtered = excludeSet ? results.filter((r) => !excludeSet.has(r.personId)) : results

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search people…"
          className="w-full rounded-lg border border-border bg-control py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-foreground-muted">No people found</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((item) => {
              const name =
                item.names.find((n) => n.preferred)?.name ??
                item.names[0]?.name ??
                `Person ${item.personId}`
              return (
                <button
                  key={item.personId}
                  type="button"
                  onClick={() => onSelect(item.personId)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-control"
                >
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-raised">
                    {item.firstFeature ? (
                      <img
                        src={api.faceUrl(item.firstFeature.featureId)}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground-faint">
                        {name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-foreground-muted">
                      {item.photoCount} photo{item.photoCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
