import { Loader2 } from 'lucide-react'
import { Skeleton } from '~/components/primitives'

interface LoadMoreSentinelProps {
  sentinelRef: (node: HTMLElement | null) => void
  isLoadingMore: boolean
  hasMore: boolean
  variant?: 'grid' | 'spinner'
  columns?: number
}

export function LoadMoreSentinel({
  sentinelRef,
  isLoadingMore,
  hasMore,
  variant = 'spinner',
  columns = 6,
}: LoadMoreSentinelProps) {
  if (!hasMore && !isLoadingMore) return null

  return (
    <div ref={sentinelRef} className="w-full">
      {isLoadingMore && variant === 'spinner' && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
        </div>
      )}
      {isLoadingMore && variant === 'grid' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: Math.min(columns, 6) }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      )}
    </div>
  )
}
