import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { IconButton, SectionCard, Skeleton } from '~/components/primitives'
import { useBreadcrumb } from '~/hooks/use-breadcrumb'
import { useFetch } from '~/hooks/use-fetch'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import { type Address, type PlaceMediaItem, api } from '~/lib/api'

const PAGE_SIZE = 60

export function PlacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const placeId = Number(id)

  if (!id || Number.isNaN(placeId)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-foreground-muted">Invalid place ID</p>
      </div>
    )
  }

  return <PlaceContent placeId={placeId} navigate={navigate} />
}

function PlaceContent({
  placeId,
  navigate,
}: {
  placeId: number
  navigate: ReturnType<typeof useNavigate>
}) {
  const {
    data: names,
    isLoading: namesLoading,
    error: namesError,
    refetch: refetchNames,
  } = useFetch(() => api.placeNames(placeId), [placeId])

  const {
    data: addresses,
    isLoading: addressesLoading,
    error: addressesError,
    refetch: refetchAddresses,
  } = useFetch(() => api.placeAddresses(placeId), [placeId])

  const mediaFetcher = useCallback(
    (offset: number, limit: number) => api.placeMedia(placeId, { offset, limit }),
    [placeId],
  )

  const {
    items: media,
    total: mediaTotal,
    isLoading: mediaLoading,
    isLoadingMore,
    hasMore,
    sentinelRef,
    error: mediaError,
    refetch: refetchMedia,
  } = useInfiniteScroll<PlaceMediaItem>({
    fetcher: mediaFetcher,
    pageSize: PAGE_SIZE,
    deps: [placeId],
  })

  const error = namesError || addressesError || mediaError
  if (error) {
    const refetch = namesError ? refetchNames : addressesError ? refetchAddresses : refetchMedia
    return <FetchError message={`Failed to load place: ${error.message}`} onRetry={refetch} />
  }

  const isLoading = namesLoading || mediaLoading
  const displayName =
    names?.items.find((n) => n.preferred)?.name ?? names?.items[0]?.name ?? `Place ${placeId}`

  useBreadcrumb(String(placeId), namesLoading ? undefined : displayName)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Back to places" onClick={() => navigate('/places')}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        {isLoading ? (
          <Skeleton className="h-7 w-40" />
        ) : (
          <h1 className="text-xl font-semibold">{displayName}</h1>
        )}
      </div>

      {/* Names */}
      <NamesSection
        placeId={placeId}
        names={names?.items ?? []}
        isLoading={namesLoading}
        onUpdate={refetchNames}
      />

      {/* Addresses */}
      <AddressesSection
        placeId={placeId}
        addresses={addresses?.items ?? []}
        isLoading={addressesLoading}
        onUpdate={refetchAddresses}
      />

      {/* Media grid */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-foreground-muted uppercase tracking-wider">
          Photos
          {!mediaLoading && mediaTotal > 0 && (
            <span className="ml-2 font-normal">({mediaTotal})</span>
          )}
        </h2>
        {mediaLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder skeletons
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : media.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {media.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => navigate(`/media/${item.mediaId}`)}
                className="media-thumb aspect-square overflow-hidden rounded-lg bg-control"
              >
                <img
                  src={api.imageUrl(item.mediaId, 300)}
                  alt={item.mediaName ?? 'Media item'}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-foreground-muted text-sm">No media linked to this place</p>
        )}
        <LoadMoreSentinel
          sentinelRef={sentinelRef}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          variant="grid"
        />
      </section>
    </div>
  )
}

function NamesSection({
  placeId,
  names,
  isLoading,
  onUpdate,
}: {
  placeId: number
  names: { id: number; name: string; preferred: boolean }[]
  isLoading: boolean
  onUpdate: () => void
}) {
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await api.addPlaceName(placeId, trimmed, names.length === 0)
      setNewName('')
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (nameId: number) => {
    try {
      await api.removePlaceName(placeId, nameId)
      onUpdate()
    } catch {
      // Removal failed — silently ignore; UI remains consistent
    }
  }

  return (
    <SectionCard title="Names">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-36" />
        </div>
      ) : (
        <div className="space-y-3">
          {names.length > 0 ? (
            <ul className="space-y-2">
              {names.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground">
                    {n.name}
                    {n.preferred && <span className="ml-2 text-xs text-accent">(preferred)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(n.id)}
                    className="text-foreground-faint hover:text-error transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">No names added</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Add a name…"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function AddressesSection({
  placeId,
  addresses,
  isLoading,
  onUpdate,
}: {
  placeId: number
  addresses: Address[]
  isLoading: boolean
  onUpdate: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ street: '', city: '', state: '', postalCode: '' })
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    setSaving(true)
    try {
      await api.addPlaceAddress(placeId, {
        street: form.street || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode || undefined,
      })
      setForm({ street: '', city: '', state: '', postalCode: '' })
      setShowForm(false)
      onUpdate()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (addressId: number) => {
    try {
      await api.removePlaceAddress(placeId, addressId)
      onUpdate()
    } catch {
      // Removal failed — silently ignore; UI remains consistent
    }
  }

  return (
    <SectionCard
      title="Addresses"
      action={
        !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.length > 0 ? (
            <ul className="space-y-2">
              {addresses.map((addr) => (
                <li key={addr.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground">{formatAddress(addr)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(addr.id)}
                    className="text-foreground-faint hover:text-error transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !showForm && <p className="text-sm text-foreground-muted">No addresses added</p>
          )}

          {showForm && (
            <div className="space-y-2 rounded-lg border border-border-subtle p-3">
              <input
                type="text"
                value={form.street}
                onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
                placeholder="Street"
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="City"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none"
                />
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  placeholder="State"
                  className="w-20 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none"
                />
                <input
                  type="text"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  placeholder="Zip"
                  className="w-24 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function formatAddress(addr: Address): string {
  const parts = [addr.street, addr.city, addr.state, addr.postalCode].filter(Boolean)
  return parts.join(', ') || 'No details'
}
