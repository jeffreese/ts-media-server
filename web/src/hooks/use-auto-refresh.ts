import { useCallback, useEffect, useRef } from 'react'
import { useModelNotifications } from '~/hooks/use-notifications'

/**
 * Triggers `refetch` when a WebSocket notification arrives for any of the
 * given model sources. Debounces rapid-fire notifications so bulk
 * operations (e.g. indexing 500 items) don't cause 500 refetches.
 */
export function useAutoRefresh(
  sources: string[],
  refetch: () => void,
  debounceMs = 1000,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handler = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      refetch()
    }, debounceMs)
  }, [refetch, debounceMs])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useModelNotifications(sources, handler)
}
