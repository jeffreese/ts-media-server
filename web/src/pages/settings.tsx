import { Moon, Sun } from 'lucide-react'
import { useTheme } from '~/hooks/use-theme'

export function SettingsPage() {
  const { theme, toggle } = useTheme()

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-foreground-muted uppercase tracking-wider">
          Appearance
        </h2>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-sm text-foreground-muted">
                {theme === 'dark' ? 'Dark mode is active' : 'Light mode is active'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-2 rounded-lg border border-border bg-control px-3 py-2 text-sm transition-colors hover:bg-control-hover"
            >
              {theme === 'dark' ? (
                <>
                  <Moon className="h-4 w-4" />
                  Dark
                </>
              ) : (
                <>
                  <Sun className="h-4 w-4" />
                  Light
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
