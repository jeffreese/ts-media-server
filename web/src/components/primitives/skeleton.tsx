import type { ComponentPropsWithoutRef } from 'react'

type SkeletonProps = ComponentPropsWithoutRef<'div'>

export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return <div className={`skeleton rounded-lg ${className}`} {...props} />
}
