import { useNavigate } from 'react-router-dom'
import { SectionCard, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

interface DuplicatesSectionProps {
  mediaItemId: number
}

export function DuplicatesSection({ mediaItemId }: DuplicatesSectionProps) {
  const navigate = useNavigate()
  const { data, isLoading } = useFetch(() => api.mediaItemMatches(mediaItemId, { limit: 100 }), [mediaItemId])

  if (isLoading) {
    return (
      <SectionCard title="Similar Media">
        <div className="flex gap-2">
          <Skeleton className="h-20 w-20 rounded-lg" />
          <Skeleton className="h-20 w-20 rounded-lg" />
        </div>
      </SectionCard>
    )
  }

  const matches = data?.items ?? []

  if (matches.length === 0) return null

  const matchedIds = matches.map((m) =>
    m.mediaItemId === mediaItemId ? m.matchingItemId : m.mediaItemId,
  )
  const uniqueIds = [...new Set(matchedIds)]

  return (
    <SectionCard title={`Similar Media (${uniqueIds.length})`}>
      <div className="flex flex-wrap gap-2">
        {uniqueIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(`/media/${id}`)}
            className="h-20 w-20 overflow-hidden rounded-lg bg-control transition-transform hover:scale-105"
          >
            <img
              src={api.imageUrl(id, 150)}
              alt={`Similar item ${id}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </SectionCard>
  )
}
