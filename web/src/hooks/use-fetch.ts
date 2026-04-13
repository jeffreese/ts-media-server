import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface UseFetchResult<T> {
  data: T | undefined
  error: Error | undefined
  status: Status
  isLoading: boolean
  refetch: () => void
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseFetchResult<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [status, setStatus] = useState<Status>('idle')
  const versionRef = useRef(0)

  const execute = useCallback(() => {
    const version = ++versionRef.current
    setStatus('loading')
    setError(undefined)

    fetcher()
      .then((result) => {
        if (version === versionRef.current) {
          setData(result)
          setStatus('success')
        }
      })
      .catch((err) => {
        if (version === versionRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setStatus('error')
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    execute()
  }, [execute])

  return {
    data,
    error,
    status,
    isLoading: status === 'loading',
    refetch: execute,
  }
}
