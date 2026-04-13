import { ChevronLeft, ChevronRight, ExternalLink, Info, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconButton } from '~/components/primitives'
import { type MediaItemEntry, api } from '~/lib/api'

interface LightboxProps {
  items: MediaItemEntry[]
  startIndex: number
  onClose: () => void
}

export function Lightbox({ items, startIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex)
  const [showInfo, setShowInfo] = useState(false)
  const navigate = useNavigate()
  const item = items[index]

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : items.length - 1))
  }, [items.length])

  const goNext = useCallback(() => {
    setIndex((i) => (i < items.length - 1 ? i + 1 : 0))
  }, [items.length])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          goPrev()
          break
        case 'ArrowRight':
          goNext()
          break
      }
    }

    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose, goPrev, goNext])

  if (!item) return null

  return (
    <div className="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center">
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
        <span className="text-sm text-white/70">
          {index + 1} / {items.length}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            label="Toggle info"
            className="text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => setShowInfo((s) => !s)}
          >
            <Info className="h-5 w-5" />
          </IconButton>
          <IconButton
            label="Close"
            className="text-white/70 hover:text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      {/* Navigation */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Image */}
      <img
        key={item.id}
        src={api.imageUrl(item.id, 1920)}
        alt={item.name ?? `Media ${item.id}`}
        className="max-h-[90vh] max-w-[90vw] object-contain"
      />

      {/* Info panel */}
      {showInfo && (
        <div className="absolute right-0 top-14 bottom-0 w-80 overflow-y-auto border-l border-white/10 bg-black/70 p-5 backdrop-blur-md">
          <h3 className="mb-4 text-sm font-semibold text-white">Details</h3>
          <dl className="space-y-3 text-sm">
            <InfoRow label="Name" value={item.name} />
            <InfoRow label="Type" value={item.type} />
            <InfoRow label="Date" value={item.startDate} />
            {item.description && <InfoRow label="Description" value={item.description} />}
          </dl>
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate(`/media/${item.id}`)
            }}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View full details
          </button>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-white/50">{label}</dt>
      <dd className="text-white/90">{value}</dd>
    </div>
  )
}
