import { Loader2 } from 'lucide-react'
import { useNotifications, type IndexingProgress } from '~/hooks/use-notifications'

export function IndexingIndicator() {
  const { indexingProgress } = useNotifications()

  if (!indexingProgress) return null

  return <IndexingBar progress={indexingProgress} />
}

function IndexingBar({ progress }: { progress: IndexingProgress }) {
  const percent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
  const isComplete = progress.current >= progress.total

  return (
    <div className="flex items-center gap-2 rounded-lg bg-accent-surface px-3 py-1.5 text-xs text-accent">
      {!isComplete && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span>
        {isComplete
          ? 'Indexing complete'
          : `Indexing: ${progress.current} / ${progress.total}`}
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
