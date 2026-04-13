import { useState } from 'react'
import { SectionCard, Skeleton, TagInput } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

interface KeywordsSectionProps {
  mediaItemId: number
}

export function KeywordsSection({ mediaItemId }: KeywordsSectionProps) {
  const { data, isLoading, refetch } = useFetch(
    () => api.mediaItemKeywords(mediaItemId, { limit: 100 }),
    [mediaItemId],
  )
  const [pending, setPending] = useState(false)

  async function handleAdd(word: string) {
    setPending(true)
    try {
      await api.addKeyword(mediaItemId, word)
      refetch()
    } finally {
      setPending(false)
    }
  }

  async function handleRemove(keywordId: number) {
    setPending(true)
    try {
      await api.removeKeyword(mediaItemId, keywordId)
      refetch()
    } finally {
      setPending(false)
    }
  }

  if (isLoading) {
    return (
      <SectionCard title="Keywords">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-14" />
        </div>
      </SectionCard>
    )
  }

  const tags = data?.items ?? []

  return (
    <SectionCard title="Keywords">
      <TagInput
        tags={tags.map((k) => ({ id: k.id, word: k.word }))}
        onAdd={handleAdd}
        onRemove={handleRemove}
        disabled={pending}
        placeholder="Add keyword..."
      />
    </SectionCard>
  )
}
