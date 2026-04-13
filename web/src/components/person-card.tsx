import { useFetch } from '~/hooks/use-fetch'
import { api, type Person } from '~/lib/api'

interface PersonCardProps {
  person: Person
  onClick: () => void
}

export function PersonCard({ person, onClick }: PersonCardProps) {
  const { data: names } = useFetch(() => api.personNames(person.id), [person.id])
  const { data: features } = useFetch(
    () => api.personFeatures(person.id, { limit: 1 }),
    [person.id],
  )

  const displayName =
    names?.items.find((n) => n.preferred)?.name ?? names?.items[0]?.name ?? `Person ${person.id}`

  const firstFeature = features?.items[0]

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl p-3 transition-colors hover:bg-surface-raised"
    >
      <div className="aspect-square w-full max-w-[120px] overflow-hidden rounded-full bg-control">
        {firstFeature ? (
          <img
            src={api.faceUrl(firstFeature.featureId)}
            alt={displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-foreground-faint">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className="text-sm font-medium text-foreground truncate w-full text-center">
        {displayName}
      </span>
      {features && features.total > 0 && (
        <span className="text-xs text-foreground-muted">
          {features.total} photo{features.total !== 1 ? 's' : ''}
        </span>
      )}
    </button>
  )
}
