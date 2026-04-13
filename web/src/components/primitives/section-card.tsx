import type { ReactNode } from 'react'

interface SectionCardProps {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function SectionCard({ title, children, action }: SectionCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
