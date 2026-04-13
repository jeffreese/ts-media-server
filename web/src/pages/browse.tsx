import { Folder } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { MediaGrid } from '~/components/media-grid'
import { Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import { type FolderEntry, api } from '~/lib/api'

export function BrowsePage() {
  const params = useParams()
  const navigate = useNavigate()
  const path = params['*'] ?? ''

  const { data, isLoading, error } = useFetch(() => api.index(path, { limit: 200 }), [path])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Failed to load: {error.message}</p>
      </div>
    )
  }

  if (isLoading || !data) {
    return <BrowseSkeleton />
  }

  const hasContent = data.folders.length > 0 || data.items.length > 0

  return (
    <div className="space-y-6">
      {data.folders.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
            Folders
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.folders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onClick={() => {
                  const next = path ? `${path}/${folder.name}` : folder.name
                  navigate(`/browse/${next}`)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {data.items.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
            {data.items.length} item{data.items.length !== 1 ? 's' : ''}
          </h2>
          <MediaGrid items={data.items} />
        </section>
      )}

      {!hasContent && (
        <div className="flex h-64 items-center justify-center">
          <p className="text-foreground-muted">This folder is empty</p>
        </div>
      )}
    </div>
  )
}

function FolderCard({ folder, onClick }: { folder: FolderEntry; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent hover:bg-surface-raised"
    >
      <Folder className="h-8 w-8 text-accent" />
      <span className="text-sm font-medium text-foreground truncate w-full text-center">
        {folder.name}
      </span>
    </button>
  )
}

function BrowseSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
