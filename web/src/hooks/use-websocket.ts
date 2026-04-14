import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface Notification {
  action: string
  source: string
  id: string
  userId: string
  timestamp: number
}

interface UseWebSocketOptions {
  url: string
  reconnectInterval?: number
  maxReconnectInterval?: number
}

interface UseWebSocketResult {
  status: ConnectionStatus
  lastNotification: Notification | null
}

const DEFAULT_RECONNECT_INTERVAL = 2000
const MAX_RECONNECT_INTERVAL = 30000

export function parseMessage(data: string): Notification | null {
  const parts = data.split(',')
  if (parts.length < 2) return null
  return {
    action: parts[0]!,
    source: parts[1]!,
    id: parts[2] ?? '',
    userId: parts[3] ?? '',
    timestamp: Date.now(),
  }
}

export function useWebSocket({
  url,
  reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
  maxReconnectInterval = MAX_RECONNECT_INTERVAL,
}: UseWebSocketOptions): UseWebSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastNotification, setLastNotification] = useState<Notification | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const unmountedRef = useRef(false)

  const connect = useCallback(() => {
    if (unmountedRef.current) return

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      if (unmountedRef.current) {
        ws.close()
        return
      }
      retriesRef.current = 0
      setStatus('connected')
    })

    ws.addEventListener('message', (event) => {
      if (unmountedRef.current) return
      const notification = parseMessage(String(event.data))
      if (notification) {
        setLastNotification(notification)
      }
    })

    ws.addEventListener('close', () => {
      if (unmountedRef.current) return
      wsRef.current = null
      setStatus('disconnected')
      scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      if (unmountedRef.current) return
      ws.close()
    })

    function scheduleReconnect() {
      if (unmountedRef.current) return
      const delay = Math.min(
        reconnectInterval * 2 ** retriesRef.current,
        maxReconnectInterval,
      )
      retriesRef.current++
      reconnectTimeoutRef.current = setTimeout(connect, delay)
    }
  }, [url, reconnectInterval, maxReconnectInterval])

  useEffect(() => {
    unmountedRef.current = false
    connect()

    return () => {
      unmountedRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return { status, lastNotification }
}
