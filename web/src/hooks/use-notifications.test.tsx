import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { WebSocketProvider, useNotifications, useModelNotifications } from '~/hooks/use-notifications'

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
})

function wrapper({ children }: { children: ReactNode }) {
  return <WebSocketProvider>{children}</WebSocketProvider>
}

function fireWsEvent(event: string, data?: unknown) {
  for (const handler of handlers[event] ?? []) {
    handler(data)
  }
}

describe('WebSocketProvider', () => {
  it('provides connection status', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })

    expect(result.current.status).toBe('connecting')

    act(() => {
      fireWsEvent('open')
    })

    expect(result.current.status).toBe('connected')
  })

  it('parses notifications and updates lastNotification', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,5,2' })
    })

    await waitFor(() => {
      expect(result.current.lastNotification).toMatchObject({
        action: 'create',
        source: 'mediaItem',
        id: '5',
        userId: '2',
      })
    })
  })

  it('parses indexing progress events', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'progress,fileIndex,indexing:10/50,' })
    })

    await waitFor(() => {
      expect(result.current.indexingProgress).toMatchObject({
        current: 10,
        total: 50,
        source: 'fileIndex',
      })
    })
  })
})

describe('useModelNotifications', () => {
  it('calls handler when matching source notification arrives', async () => {
    const handler = vi.fn()

    renderHook(() => useModelNotifications(['mediaItem'], handler), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
    })

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', source: 'mediaItem' }),
      )
    })
  })

  it('does not call handler for non-matching sources', async () => {
    const handler = vi.fn()

    renderHook(() => useModelNotifications(['folder'], handler), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
    })

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50))

    expect(handler).not.toHaveBeenCalled()
  })

  it('wildcard source matches all notifications', async () => {
    const handler = vi.fn()

    renderHook(() => useModelNotifications(['*'], handler), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'create,mediaItem,1,' })
    })

    act(() => {
      fireWsEvent('message', { data: 'update,folder,2,' })
    })

    await waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  it('does not call handler for progress events', async () => {
    const handler = vi.fn()

    renderHook(() => useModelNotifications(['fileIndex'], handler), { wrapper })

    act(() => {
      fireWsEvent('open')
    })

    act(() => {
      fireWsEvent('message', { data: 'progress,fileIndex,indexing:1/10,' })
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(handler).not.toHaveBeenCalled()
  })
})
