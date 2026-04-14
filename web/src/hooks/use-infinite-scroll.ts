import { useCallback, useEffect, useRef, useState } from 'react'

interface PaginatedPage<T> {
  items: T[]
  offset: number
  limit: number
  total: number
}

interface UseInfiniteScrollOptions<T> {
  fetcher: (offset: number, limit: number) => Promise<PaginatedPage<T>>
  pageSize?: number
  deps?: unknown[]
}

interface UseInfiniteScrollResult<T> {
  items: T[]
  total: number
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | undefined
  hasMore: boolean
  loadMore: () => void
  sentinelRef: (node: HTMLElement | null) => void
  refetch: () => void
}

const DEFAULT_PAGE_SIZE = 60

export function useInfiniteScroll<T>({
  fetcher,
  pageSize = DEFAULT_PAGE_SIZE,
  deps = [],
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const versionRef = useRef(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelNodeRef = useRef<HTMLElement | null>(null)
  const offsetRef = useRef(0)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)

  const fetchPage = useCallback(
    async (offset: number, version: number, append: boolean) => {
      if (loadingRef.current) return
      loadingRef.current = true

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(undefined)
      }

      try {
        const page = await fetcher(offset, pageSize)
        if (version !== versionRef.current) return

        const newItems = page.items
        setTotal(page.total)

        if (append) {
          setItems((prev) => [...prev, ...newItems])
        } else {
          setItems(newItems)
        }

        offsetRef.current = offset + newItems.length
        hasMoreRef.current = offset + newItems.length < page.total

        if (append) {
          setIsLoadingMore(false)
        } else {
          setIsLoading(false)
        }
      } catch (err) {
        if (version !== versionRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsLoading(false)
        setIsLoadingMore(false)
      } finally {
        loadingRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetcher, pageSize, ...deps],
  )

  const loadMore = useCallback(() => {
    if (!hasMoreRef.current || loadingRef.current) return
    fetchPage(offsetRef.current, versionRef.current, true)
  }, [fetchPage])

  const refetch = useCallback(() => {
    const version = ++versionRef.current
    offsetRef.current = 0
    hasMoreRef.current = true
    setItems([])
    fetchPage(0, version, false)
  }, [fetchPage])

  useEffect(() => {
    const version = ++versionRef.current
    offsetRef.current = 0
    hasMoreRef.current = true
    loadingRef.current = false
    setItems([])
    setTotal(0)
    fetchPage(0, version, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage])

  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }

      sentinelNodeRef.current = node
      if (!node) return

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            loadMore()
          }
        },
        { rootMargin: '200px' },
      )
      observerRef.current.observe(node)
    },
    [loadMore],
  )

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  return {
    items,
    total,
    isLoading,
    isLoadingMore,
    error,
    hasMore: hasMoreRef.current && !isLoading && items.length < total,
    loadMore,
    sentinelRef,
    refetch,
  }
}
