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
      <div className="flex flex-wrap gap-3">
        {faces.map((face) => (
          <FaceChip key={face.id} face={face} />
        ))}
      </div>
    </SectionCard>
  )
}

function FaceChip({ face }: { face: Feature }) {
  const { data: personData } = useFetch(
    () => api.featurePerson(face.id).catch(() => null),
    [face.id],
  )

  const personName = personData?.names.find((n) => n.preferred)?.name ?? personData?.names[0]?.name

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="h-16 w-16 overflow-hidden rounded-full bg-control ring-2 ring-border">
        <img
          src={api.faceUrl(face.id)}
          alt={personName ?? `Face ${face.id}`}
          className="h-full w-full object-cover"
        />
      </div>
      {personName && (
        <span className="max-w-[80px] truncate text-xs text-foreground-muted">{personName}</span>
      )}
    </div>
  )
}
