import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'

function makeFetcher(totalItems: number) {
  const items = Array.from({ length: totalItems }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))

  return vi.fn(async (offset: number, limit: number) => {
    const slice = items.slice(offset, offset + limit)
    return { items: slice, offset, limit, total: totalItems }
  })
}

describe('useInfiniteScroll', () => {
  it('fetches the first page on mount', async () => {
    const fetcher = makeFetcher(10)

    const { result } = renderHook(() =>
      useInfiniteScroll({ fetcher, pageSize: 5 }),
    )

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.items).toHaveLength(5)
    expect(result.current.total).toBe(10)
    expect(result.current.hasMore).toBe(true)
  })

  it('loads more items on loadMore call', async () => {
    const fetcher = makeFetcher(10)

    const { result } = renderHook(() =>
      useInfiniteScroll({ fetcher, pageSize: 5 }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.loadMore()
    })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(10)
    })

    expect(result.current.hasMore).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('handles errors', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Server error')
    })

    const { result } = renderHook(() =>
      useInfiniteScroll({ fetcher, pageSize: 5 }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Server error')
    expect(result.current.items).toHaveLength(0)
  })

  it('refetch resets and reloads', async () => {
    const fetcher = makeFetcher(10)

    const { result } = renderHook(() =>
      useInfiniteScroll({ fetcher, pageSize: 5 }),
    )

    await waitFor(() => {
      expect(result.current.items).toHaveLength(5)
    })

    act(() => {
      result.current.loadMore()
    })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(10)
    })

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(5)
    })

    expect(result.current.total).toBe(10)
  })

  it('returns hasMore=false when all items loaded', async () => {
    const fetcher = makeFetcher(3)

    const { result } = renderHook(() =>
      useInfiniteScroll({ fetcher, pageSize: 5 }),
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.items).toHaveLength(3)
    expect(result.current.hasMore).toBe(false)
  })
})
