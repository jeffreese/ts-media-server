import { Tag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { type KeywordWithCount, api } from '~/lib/api'

export function KeywordsPage() {
  const { data, isLoading, error } = useFetch(() => api.keywords({ limit: 500 }), [])
  const navigate = useNavigate()

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load keywords: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !data) {
    return <KeywordsSkeleton />
  }

  if (data.items.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Tag className="h-10 w-10 text-foreground-faint" />
        <p className="text-foreground-muted">No keywords yet</p>
        <p className="text-sm text-foreground-faint">
          Tag media items with keywords from the media detail page
        </p>
      </div>
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
