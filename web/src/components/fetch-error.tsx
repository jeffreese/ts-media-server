import { AlertTriangle, RefreshCw } from 'lucide-react'

interface FetchErrorProps {
  message: string
  onRetry?: () => void
}

export function FetchError({ message, onRetry }: FetchErrorProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-warning" />
        <p className="text-foreground-muted">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
