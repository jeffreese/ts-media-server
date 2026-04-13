import { Film } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbox } from '~/components/lightbox'
import { type MediaItemEntry, api } from '~/lib/api'

interface MediaGridProps {
  items: MediaItemEntry[]
}

export function MediaGrid({ items }: MediaGridProps) {
  const navigate = useNavigate()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const handleClick = useCallback(
    (item: MediaItemEntry, index: number) => {
      if (item.type === 'video') {
        navigate(`/media/${item.id}`)
      } else {
        setLightboxIndex(index)
      }
    },
    [navigate],
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item, i) => (
          <MediaThumbnail key={item.id} item={item} onClick={() => handleClick(item, i)} />
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox items={items} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  )
}

function MediaThumbnail({ item, onClick }: { item: MediaItemEntry; onClick: () => void }) {
  const isVideo = item.type === 'video'

  return (
    <button
      type="button"
      onClick={onClick}
      className="media-thumb group relative aspect-square overflow-hidden rounded-lg bg-control focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
    >
      <img
        src={api.imageUrl(item.id, 300)}
        alt={item.name ?? `Media ${item.id}`}
        loading="lazy"
        className="h-full w-full object-cover"
      />

      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white">
            <Film className="h-5 w-5" />
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="truncate text-xs text-white">{item.name ?? `Item ${item.id}`}</p>
      </div>
    </button>
  )
}
