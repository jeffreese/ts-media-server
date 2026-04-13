import { NavLink, useLocation } from 'react-router-dom'
import { Images, Users, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', icon: Images, label: 'Browse' },
  { to: '/people', icon: Users, label: 'People' },
] as const

export function Sidebar() {
  const location = useLocation()

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

      <div className="border-t border-border p-3">
        <NavLink
          to="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  )
}
