import type { ComponentPropsWithoutRef, ReactNode } from 'react'

interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'error'
  children: ReactNode
}

const VARIANT_CLASSES: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-control text-foreground-secondary',
  accent: 'bg-accent-muted text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  error: 'bg-error/15 text-error',
}

export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}
