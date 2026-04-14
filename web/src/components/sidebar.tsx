import { Images, LogOut, Map as MapIcon, MapPin, Settings, Shield, Tag, Users } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '~/hooks/use-auth'

const NAV_ITEMS = [
  { to: '/', icon: Images, label: 'Browse' },
  { to: '/keywords', icon: Tag, label: 'Keywords' },
  { to: '/people', icon: Users, label: 'People' },
  { to: '/places', icon: MapPin, label: 'Places' },
  { to: '/map', icon: MapIcon, label: 'Map' },
] as const

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, authEnabled, logout } = useAuth()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="hidden w-[var(--sidebar-width)] flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Images className="h-5 w-5 text-accent" />
        <span className="text-sm font-semibold tracking-tight">Media Server</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive =
            to === '/'
              ? location.pathname === '/' || location.pathname.startsWith('/browse')
              : location.pathname.startsWith(to)

          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-accent-surface text-accent font-medium'
                  : 'text-foreground-muted hover:bg-control hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-border p-3 space-y-1">
        <NavLink
          to="/admin"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            location.pathname.startsWith('/admin')
              ? 'bg-accent-surface text-accent font-medium'
              : 'text-foreground-muted hover:bg-control hover:text-foreground'
          }`}
        >
          <Shield className="h-4 w-4" />
          Admin
        </NavLink>
        <NavLink
          to="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>

        {authEnabled && user && (
          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <span className="truncate text-xs text-foreground-muted">
              {user.name ?? `User ${user.id}`}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex-shrink-0 rounded p-1 text-foreground-faint transition-colors hover:bg-control hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
