import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { setTokenAccessor, setUnauthorizedHandler } from '~/lib/api'

// Uses raw fetch() instead of ~/lib/api.ts because this hook bootstraps
// the token that the API client depends on — using api.ts here would
// create a circular dependency.

interface AuthUser {
  id: number
  name: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  authEnabled: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  getToken: () => string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authEnabled, setAuthEnabled] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const tokenRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const scheduleRefresh = useCallback((token: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const exp = parseJwtExp(token)
    if (!exp) return
    const delay = Math.max(exp - Date.now() - TOKEN_REFRESH_MARGIN_MS, 10_000)
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
        })
        if (!res.ok) {
          tokenRef.current = null
          setUser(null)
          return
        }
        const data = (await res.json()) as { token: string; user: AuthUser }
        tokenRef.current = data.token
        setUser(data.user)
        scheduleRefresh(data.token)
      } catch {
        tokenRef.current = null
        setUser(null)
      }
    }, delay)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkStatus() {
      try {
        const res = await fetch('/auth/status', {
          headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
        })
        if (!res.ok) throw new Error('status check failed')
        const data = (await res.json()) as {
          authEnabled: boolean
          user: AuthUser | null
        }
        if (cancelled) return
        setAuthEnabled(data.authEnabled)
        setUser(data.user)
      } catch {
        if (cancelled) return
        setAuthEnabled(true)
        setUser(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    checkStatus()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Login failed' }))
        throw new Error(body.error ?? 'Login failed')
      }
      const data = (await res.json()) as { token: string; user: AuthUser }
      tokenRef.current = data.token
      setUser(data.user)
      scheduleRefresh(data.token)
    },
    [scheduleRefresh],
  )

  const logout = useCallback(() => {
    tokenRef.current = null
    setUser(null)
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
  }, [])

  const getToken = useCallback(() => tokenRef.current, [])

  useEffect(() => {
    setTokenAccessor(getToken)
    setUnauthorizedHandler(logout)
    return () => {
      setTokenAccessor(() => null)
      setUnauthorizedHandler(() => {})
    }
  }, [getToken, logout])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, authEnabled, isLoading, login, logout, getToken }),
    [user, authEnabled, isLoading, login, logout, getToken],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
