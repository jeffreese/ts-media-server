import {
  ChevronDown,
  ChevronUp,
  Link2,
  Link2Off,
  Merge,
  Plus,
  Search,
  UserPlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconButton, SectionCard, Skeleton } from '~/components/primitives'
import { useFetch } from '~/hooks/use-fetch'
import {
  type Feature,
  type MatchingFace,
  type Person,
  type PersonBatchItem,
  type PersonName,
  api,
} from '~/lib/api'

interface FacesSectionProps {
  mediaItemId: number
}

export function FacesSection({ mediaItemId }: FacesSectionProps) {
  const { data, isLoading, refetch } = useFetch(
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
          <FaceChip
            key={face.id}
            face={face}
            currentMediaId={mediaItemId}
            onLinkChanged={refetch}
          />
        ))}
      </div>
    </SectionCard>
  )
}

interface PersonLinkData {
  person: Person
  names: PersonName[]
  link: { personFeatureId: number; personId: number; featureId: number }
}

function FaceChip({
  face,
  currentMediaId,
  onLinkChanged,
}: {
  face: Feature
  currentMediaId: number
  onLinkChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { data: personData, refetch: refetchPerson } = useFetch(
    () => api.featurePerson(face.id).catch(() => null),
    [face.id],
  )

  const personName = personData?.names.find((n) => n.preferred)?.name ?? personData?.names[0]?.name

  const handleLinkChanged = useCallback(() => {
    refetchPerson()
    onLinkChanged()
  }, [refetchPerson, onLinkChanged])

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-control"
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
            {personData && <span className="ml-1.5 text-xs text-foreground-muted">(linked)</span>}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-foreground-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" />
          )}
        </button>
        <FaceActions
          face={face}
          personData={personData ?? undefined}
          onLinkChanged={handleLinkChanged}
        />
      </div>

      {expanded && <MatchingFacesGrid featureId={face.id} currentMediaId={currentMediaId} />}
    </div>
  )
}

type ModalMode =
  | { type: 'assign'; face: Feature }
  | { type: 'create'; face: Feature }
  | { type: 'merge'; personData: PersonLinkData }
  | null

function FaceActions({
  face,
  personData,
  onLinkChanged,
}: {
  face: Feature
  personData: PersonLinkData | undefined
  onLinkChanged: () => void
}) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [busy, setBusy] = useState(false)

  const handleUnlink = async () => {
    if (!personData) return
    setBusy(true)
    try {
      await api.unlinkFeatureFromPerson(personData.link.personId, personData.link.personFeatureId)
      onLinkChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center">
        {personData ? (
          <>
            <IconButton
              label="Merge into another person"
              onClick={() => setModal({ type: 'merge', personData })}
            >
              <Merge className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Unlink from person" onClick={handleUnlink} disabled={busy}>
              <Link2Off className="h-3.5 w-3.5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              label="Assign to existing person"
              onClick={() => setModal({ type: 'assign', face })}
            >
              <Link2 className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Create new person"
              onClick={() => setModal({ type: 'create', face })}
            >
              <UserPlus className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
      </div>

      {modal?.type === 'assign' && (
        <AssignPersonModal
          face={modal.face}
          onClose={() => setModal(null)}
          onAssigned={onLinkChanged}
        />
      )}
      {modal?.type === 'create' && (
        <CreatePersonModal
          face={modal.face}
          onClose={() => setModal(null)}
          onCreated={onLinkChanged}
        />
      )}
      {modal?.type === 'merge' && (
        <MergePersonModal
          personData={modal.personData}
          onClose={() => setModal(null)}
          onMerged={onLinkChanged}
        />
      )}
    </>
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

  const matches = (data?.items ?? []).filter((m: MatchingFace) => m.mediaItemId !== currentMediaId)
  const uniqueMediaIds = [...new Set(matches.map((m: MatchingFace) => m.mediaItemId))]

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

// ---------------------------------------------------------------------------
// Modal backdrop
// ---------------------------------------------------------------------------

function ModalBackdrop({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={backdropRef}
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">{title}</h3>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Person search (shared between assign + merge)
// ---------------------------------------------------------------------------

function PersonSearchList({
  onSelect,
  excludePersonId,
}: {
  onSelect: (personId: number, name: string) => void
  excludePersonId?: number
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonBatchItem[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const search = useCallback(
    (q: string) => {
      setLoading(true)
      api
        .people({ limit: 200 })
        .then((res) => {
          const ids = res.items.filter((p) => p.id !== excludePersonId).map((p) => p.id)
          if (ids.length === 0) {
            setResults([])
            setLoading(false)
            return
          }
          return api.peopleBatch(ids).then((batch) => {
            const lq = q.toLowerCase()
            const filtered = batch.items.filter((item) => {
              if (!lq) return true
              return item.names.some((n) => n.name.toLowerCase().includes(lq))
            })
            setResults(filtered)
            setLoading(false)
          })
        })
        .catch(() => setLoading(false))
    },
    [excludePersonId],
  )

  useEffect(() => {
    search('')
  }, [search])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 200)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search people…"
          className="w-full rounded-lg border border-border bg-control py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-4 text-center text-sm text-foreground-muted">No people found</p>
        ) : (
          <div className="space-y-1">
            {results.map((item) => {
              const name =
                item.names.find((n) => n.preferred)?.name ??
                item.names[0]?.name ??
                `Person ${item.personId}`
              return (
                <button
                  key={item.personId}
                  type="button"
                  onClick={() => onSelect(item.personId, name)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-control"
                >
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-raised">
                    {item.firstFeature ? (
                      <img
                        src={api.faceUrl(item.firstFeature.featureId)}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground-faint">
                        {name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-foreground-muted">
                      {item.photoCount} photo{item.photoCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assign face to existing person modal
// ---------------------------------------------------------------------------

function AssignPersonModal({
  face,
  onClose,
  onAssigned,
}: {
  face: Feature
  onClose: () => void
  onAssigned: () => void
}) {
  const [busy, setBusy] = useState(false)

  const handleSelect = async (personId: number) => {
    setBusy(true)
    try {
      await api.linkFeatureToPerson(personId, face.id)
      onAssigned()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop title="Assign Face to Person" onClose={onClose}>
      {busy ? (
        <div className="flex justify-center py-8">
          <Skeleton className="h-6 w-32" />
        </div>
      ) : (
        <PersonSearchList onSelect={handleSelect} />
      )}
    </ModalBackdrop>
  )
}

// ---------------------------------------------------------------------------
// Create new person from face modal
// ---------------------------------------------------------------------------

function CreatePersonModal({
  face,
  onClose,
  onCreated,
}: {
  face: Feature
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setBusy(true)
    try {
      const person = await api.createPerson()
      await api.addPersonName(person.id, trimmed, true)
      await api.linkFeatureToPerson(person.id, face.id)
      onCreated()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop title="Create New Person" onClose={onClose}>
      <div className="mb-4 flex justify-center">
        <div className="h-20 w-20 overflow-hidden rounded-full bg-control ring-2 ring-border">
          <img
            src={api.faceUrl(face.id)}
            alt="Face to assign"
            className="h-full w-full object-cover"
          />
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="person-name"
            className="mb-1 block text-xs font-medium text-foreground-muted"
          >
            Name
          </label>
          <input
            ref={nameInputRef}
            id="person-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter person's name"
            className="w-full rounded-lg border border-border bg-control px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={busy}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-control"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
        </div>
      </form>
    </ModalBackdrop>
  )
}

// ---------------------------------------------------------------------------
// Merge person into another person modal
// ---------------------------------------------------------------------------

function MergePersonModal({
  personData,
  onClose,
  onMerged,
}: {
  personData: PersonLinkData
  onClose: () => void
  onMerged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const sourceName =
    personData.names.find((n) => n.preferred)?.name ??
    personData.names[0]?.name ??
    `Person ${personData.person.id}`

  const handleSelect = async (targetPersonId: number, targetName: string) => {
    const confirmed = window.confirm(
      `Merge "${sourceName}" into "${targetName}"? All face links will be reassigned to "${targetName}".`,
    )
    if (!confirmed) return

    setBusy(true)
    try {
      await api.mergePerson(targetPersonId, personData.person.id)
      onMerged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop title={`Merge "${sourceName}" Into…`} onClose={onClose}>
      {busy ? (
        <div className="flex justify-center py-8">
          <Skeleton className="h-6 w-32" />
        </div>
      ) : (
        <PersonSearchList onSelect={handleSelect} excludePersonId={personData.person.id} />
      )}
    </ModalBackdrop>
  )
}
