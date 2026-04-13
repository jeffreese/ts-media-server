import type { ComponentPropsWithoutRef } from 'react'

interface IconButtonProps extends ComponentPropsWithoutRef<'button'> {
  label: string
}

export function IconButton({ label, className = '', children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-lg p-2 text-foreground-muted transition-colors hover:bg-control hover:text-foreground disabled:opacity-40 disabled:pointer-events-none ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
