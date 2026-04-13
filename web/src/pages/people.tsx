import { Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PersonCard } from '~/components/person-card'
import { Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { api } from '~/lib/api'

export function PeoplePage() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useFetch(() => api.people({ limit: 200 }), [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load people: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div>
        <h1 className="mb-6 text-xl font-semibold">People</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-square rounded-full" />
              <Skeleton className="mx-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.items.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Users className="h-12 w-12 text-foreground-faint" />
        <p className="text-foreground-muted">No people found</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">
        People <span className="text-foreground-muted font-normal">({data.total})</span>
      </h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {data.items.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            onClick={() => navigate(`/people/${person.id}`)}
          />
        ))}
      </div>
    </div>
  )
}
