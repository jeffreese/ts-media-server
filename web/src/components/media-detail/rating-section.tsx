import { useState } from 'react'
import { SectionCard, Skeleton, StarRating } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

interface RatingSectionProps {
  mediaItemId: number
}

export function RatingSection({ mediaItemId }: RatingSectionProps) {
  const { data, isLoading, refetch } = useFetch(
    () => api.mediaItemRatings(mediaItemId, { limit: 10 }),
    [mediaItemId],
  )
  const [pending, setPending] = useState(false)
  const [comment, setComment] = useState('')

  const currentRating = data?.items[0]

  async function handleRate(value: number) {
    setPending(true)
    try {
      if (value === 0 && currentRating) {
        await api.removeRating(mediaItemId)
      } else if (value > 0) {
        await api.setRating(mediaItemId, value, comment || undefined)
      }
      refetch()
    } finally {
      setPending(false)
    }
  }

  if (isLoading) {
    return (
      <SectionCard title="Rating">
        <Skeleton className="h-6 w-32" />
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Rating">
      <div className="space-y-3">
        <StarRating value={currentRating?.rating ?? 0} onChange={handleRate} readonly={pending} />
        {currentRating?.comment && (
          <p className="text-sm text-foreground-secondary italic">"{currentRating.comment}"</p>
        )}
        {currentRating && !currentRating.comment && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 rounded-lg border border-border bg-control px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && comment.trim()) {
                  handleRate(currentRating.rating)
                }
              }}
            />
          </div>
        )}
      </div>
    </SectionCard>
  )
}
