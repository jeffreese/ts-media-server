import { Tag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { Badge, Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useFetch } from '~/hooks/use-fetch'
import { type KeywordWithCount, api } from '~/lib/api'

export function KeywordsPage() {
  const { data, isLoading, error, refetch } = useFetch(() => api.keywords({ limit: 500 }), [])
  const navigate = useNavigate()

  useAutoRefresh(['keyword', 'mediaItemKeyword'], refetch)

  if (error) {
    return <FetchError message={`Failed to load keywords: ${error.message}`} onRetry={refetch} />
  }

  if (isLoading || !data) {
    return <KeywordsSkeleton />
  }

  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<Tag className="h-10 w-10" />}
        title="No keywords yet"
        description="Tag media items with keywords from the media detail page to organize your library."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Keywords</h1>
        <p className="text-sm text-foreground-muted">
          {data.total} keyword{data.total !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {data.items.map((kw) => (
          <KeywordChip key={kw.id} keyword={kw} onClick={() => navigate(`/keywords/${kw.id}`)} />
        ))}
      </div>
    </div>
  )
}

function KeywordChip({ keyword, onClick }: { keyword: KeywordWithCount; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:border-accent hover:bg-surface-raised"
    >
      <Tag className="h-3.5 w-3.5 text-foreground-faint group-hover:text-accent" />
      <span className="text-sm font-medium text-foreground">{keyword.word}</span>
      <Badge variant="default">{keyword.count}</Badge>
    </button>
  )
}

function KeywordsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-32" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 20 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-24 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
