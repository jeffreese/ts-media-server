import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useWebSocket,
  type ConnectionStatus,
  type Notification,
} from '~/hooks/use-websocket'

type NotificationHandler = (notification: Notification) => void

interface WebSocketContextValue {
  status: ConnectionStatus
  lastNotification: Notification | null
  subscribe: (sources: string[], handler: NotificationHandler) => () => void
  indexingProgress: IndexingProgress | null
}

export interface IndexingProgress {
  current: number
  total: number
  source: string
  timestamp: number
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { status, lastNotification } = useWebSocket({
    url: getWebSocketUrl(),
  })

  const subscribersRef = useRef<
    Map<number, { sources: Set<string>; handler: NotificationHandler }>
  >(new Map())
  const nextIdRef = useRef(0)

  const [indexingProgress, setIndexingProgress] =
    useState<IndexingProgress | null>(null)

  useEffect(() => {
    if (!lastNotification) return

    if (lastNotification.action === 'progress') {
      // Wire format from server (websocket.ts formatMessage):
      //   progress,<source>,<phase>:<processed>/<total>,
      const raw = lastNotification.id
      const colonIdx = raw.indexOf(':')
      const phase = colonIdx >= 0 ? raw.slice(0, colonIdx) : ''
      const counts = colonIdx >= 0 ? raw.slice(colonIdx + 1) : raw
      const parts = counts.split('/')
      const current = Number.parseInt(parts[0] ?? '0', 10)
      const total = Number.parseInt(parts[1] ?? '0', 10)
      if (
        !Number.isNaN(current) &&
        !Number.isNaN(total) &&
        total > 0 &&
        phase === 'indexing'
      ) {
        setIndexingProgress({
          current,
          total,
          source: lastNotification.source,
          timestamp: lastNotification.timestamp,
        })
        if (current >= total) {
          setTimeout(() => setIndexingProgress(null), 3000)
        }
      } else if (phase === 'complete') {
        setTimeout(() => setIndexingProgress(null), 3000)
      }
      return
    }

    for (const { sources, handler } of subscribersRef.current.values()) {
      if (sources.has('*') || sources.has(lastNotification.source)) {
        try {
          handler(lastNotification)
        } catch {
          // subscriber errors should not break the notification bus
        }
      }
    }
  }, [lastNotification])

  const subscribe = useCallback(
    (sources: string[], handler: NotificationHandler): (() => void) => {
      const id = nextIdRef.current++
      subscribersRef.current.set(id, {
        sources: new Set(sources),
        handler,
      })
      return () => {
        subscribersRef.current.delete(id)
      }
    },
    [],
  )

  return (
    <WebSocketContext
      value={{ status, lastNotification, subscribe, indexingProgress }}
    >
      {children}
    </WebSocketContext>
  )
}

export function useNotifications() {
  const ctx = useContext(WebSocketContext)
  if (!ctx)
    throw new Error('useNotifications must be used within WebSocketProvider')
  return ctx
}

/**
 * Subscribe to notifications for specific model sources.
 * Calls `handler` whenever a matching notification arrives.
 * Pass `['*']` to match all sources.
 */
export function useModelNotifications(
  sources: string[],
  handler: NotificationHandler,
) {
  const { subscribe } = useNotifications()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return subscribe(sources, (n) => handlerRef.current(n))
  }, [subscribe, ...sources])
}
