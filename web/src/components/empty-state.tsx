import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="text-foreground-faint">{icon}</div>
      <p className="text-sm font-medium text-foreground-muted">{title}</p>
      {description && <p className="max-w-xs text-sm text-foreground-faint">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
