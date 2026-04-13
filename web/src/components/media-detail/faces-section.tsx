import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionCard, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { type Feature, api } from '~/lib/api'

interface FacesSectionProps {
  mediaItemId: number
}

export function FacesSection({ mediaItemId }: FacesSectionProps) {
  const { data, isLoading } = useFetch(
    () => api.mediaItemFeatures(mediaItemId, { limit: 50 }),
    [mediaItemId],
  )

  if (isLoading) {
    return (
      <SectionCard title="Detected Faces">
        <div className="flex gap-3">
          <Skeleton key="s0" className="h-16 w-16 rounded-full" />
          <Skeleton key="s1" className="h-16 w-16 rounded-full" />
          <Skeleton key="s2" className="h-16 w-16 rounded-full" />
        </div>
      </SectionCard>
    )
  }

  const faces = data?.items ?? []
  if (faces.length === 0) return null

  return (
    <SectionCard title={`Detected Faces (${faces.length})`}>
      <div className="space-y-4">
        {faces.map((face) => (
          <FaceChip key={face.id} face={face} currentMediaId={mediaItemId} />
        ))}
      </div>
    </SectionCard>
  )
}

function FaceChip({ face, currentMediaId }: { face: Feature; currentMediaId: number }) {
  const [expanded, setExpanded] = useState(false)
  const { data: personData } = useFetch(
    () => api.featurePerson(face.id).catch(() => null),
    [face.id],
  )

  const personName = personData?.names.find((n) => n.preferred)?.name ?? personData?.names[0]?.name

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-control"
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-control ring-2 ring-border">
          <img
            src={api.faceUrl(face.id)}
            alt={personName ?? `Face ${face.id}`}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">{personName ?? `Face ${face.id}`}</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-foreground-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" />
        )}
      </button>

      {expanded && <MatchingFacesGrid featureId={face.id} currentMediaId={currentMediaId} />}
    </div>
  )
}

function MatchingFacesGrid({
  featureId,
  currentMediaId,
}: {
  featureId: number
  currentMediaId: number
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useFetch(
    () => api.matchingFaces(featureId, { limit: 50 }),
    [featureId],
  )

  if (isLoading) {
    return (
      <div className="flex gap-2 pl-[60px] pt-2">
        <Skeleton className="h-16 w-16 rounded-lg" />
        <Skeleton className="h-16 w-16 rounded-lg" />
        <Skeleton className="h-16 w-16 rounded-lg" />
      </div>
    )
  }

  const matches = (data?.items ?? []).filter((m) => m.mediaItemId !== currentMediaId)
  const uniqueMediaIds = [...new Set(matches.map((m) => m.mediaItemId))]

  if (uniqueMediaIds.length === 0) {
    return <p className="pl-[60px] pt-2 text-xs text-foreground-muted">No matching faces found</p>
  }

  return (
    <div className="flex flex-wrap gap-2 pl-[60px] pt-2">
      {uniqueMediaIds.map((mediaId) => (
        <button
          key={mediaId}
          type="button"
          onClick={() => navigate(`/media/${mediaId}`)}
          className="h-16 w-16 overflow-hidden rounded-lg bg-control transition-transform hover:scale-105"
        >
          <img
            src={api.imageUrl(mediaId, 150)}
            alt={`Match in item ${mediaId}`}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  )
}
