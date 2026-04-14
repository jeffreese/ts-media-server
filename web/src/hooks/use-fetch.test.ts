import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useFetch } from '~/hooks/use-fetch'

describe('useFetch', () => {
  it('starts in loading state', () => {
    const fetcher = vi.fn(() => new Promise<string>(() => {}))
    const { result } = renderHook(() => useFetch(fetcher))

    expect(result.current.status).toBe('loading')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it('resolves to success with data', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ name: 'test' }))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(result.current.data).toEqual({ name: 'test' })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it('resolves to error state on failure', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('Network error')))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Network error')
    expect(result.current.data).toBeUndefined()
  })

  it('wraps non-Error rejections in Error', async () => {
    const fetcher = vi.fn(() => Promise.reject('string error'))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('string error')
  })

  it('refetch re-executes the fetcher', async () => {
    let callCount = 0
    const fetcher = vi.fn(() => Promise.resolve({ count: ++callCount }))
    const { result } = renderHook(() => useFetch(fetcher))

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })
    expect(result.current.data).toEqual({ count: 1 })

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ count: 2 })
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('ignores stale responses when deps change', async () => {
    let resolveFirst: (value: string) => void
    let resolveSecond: (value: string) => void
    const firstPromise = new Promise<string>((r) => { resolveFirst = r })
    const secondPromise = new Promise<string>((r) => { resolveSecond = r })

    let deps = [1]
    const fetcher = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)

    const { result, rerender } = renderHook(() => useFetch(fetcher, deps))

    deps = [2]
    rerender()

    resolveSecond!('second')
    resolveFirst!('first')

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })

    expect(result.current.data).toBe('second')
  })
})
