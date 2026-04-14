import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { WebSocketProvider } from '~/hooks/use-notifications'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'

type MockSocket = {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  readyState: number
  OPEN: number
  CLOSED: number
  send: ReturnType<typeof vi.fn>
}

let mockSocket: MockSocket
let handlers: Record<string, ((...args: unknown[]) => void)[]>

beforeEach(() => {
  vi.useFakeTimers()
  handlers = {}
  mockSocket = {
    addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    OPEN: 1,
    CLOSED: 3,
    send: vi.fn(),
  }
  vi.stubGlobal('WebSocket', vi.fn(() => mockSocket))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function wrapper({ children }: { children: ReactNode }) {
  return <WebSocketProvider>{children}</WebSocketProvider>
}

function fireWsEvent(event: string, data?: unknown) {
  for (const handler of handlers[event] ?? []) {
    handler(data)
  }
}

describe('useAutoRefresh', () => {
  it('calls refetch after debounce when matching notification arrives', async () => {
    const refetch = vi.fn()

    renderHook(() => useAutoRefresh(['mediaItem'], refetch, 500), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
    })

    expect(refetch).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('debounces rapid notifications', () => {
    const refetch = vi.fn()

    renderHook(() => useAutoRefresh(['mediaItem'], refetch, 500), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
      fireWsEvent('message', { data: 'create,mediaItem,2,' })
      fireWsEvent('message', { data: 'create,mediaItem,3,' })
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not call refetch for non-matching sources', () => {
    const refetch = vi.fn()

    renderHook(() => useAutoRefresh(['folder'], refetch, 500), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(refetch).not.toHaveBeenCalled()
  })
})
