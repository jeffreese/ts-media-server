import { ChevronRight, Menu, Moon, Sun } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '~/hooks/use-theme'

export function Topbar() {
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()

  const breadcrumbs = buildBreadcrumbs(location.pathname)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg p-1.5 text-foreground-muted hover:bg-control md:hidden"
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-foreground-faint" />}
              {i === breadcrumbs.length - 1 ? (
                <span className="font-medium text-foreground">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(crumb.path)}
                  className="text-foreground-muted hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>

      <button
        type="button"
        onClick={toggle}
        className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  )
}

interface Breadcrumb {
  label: string
  path: string
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  if (pathname === '/') return [{ label: 'Browse', path: '/' }]

  const segments = pathname.replace(/^\//, '').split('/')
  const crumbs: Breadcrumb[] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const path = `/${segments.slice(0, i + 1).join('/')}`
    const label = segment.charAt(0).toUpperCase() + segment.slice(1)
    crumbs.push({ label, path })
  }

  return crumbs
}
