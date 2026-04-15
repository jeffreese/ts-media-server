import {
  Activity,
  ChevronRight,
  Database,
  Download,
  File,
  Folder,
  FolderSync,
  HardDrive,
  Image,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Upload,
  Users,
  Video,
  Wrench,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FetchError } from '~/components/fetch-error'
import { SectionCard } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useFetch } from '~/hooks/use-fetch'
import { useNotifications } from '~/hooks/use-notifications'
import { type DirEntry, type Setting, api } from '~/lib/api'

type Tab = 'overview' | 'settings' | 'files' | 'indexing' | 'maintenance'

const TABS: { id: Tab; label: string; icon: typeof Database }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'files', label: 'File Browser', icon: HardDrive },
  { id: 'indexing', label: 'Indexing', icon: FolderSync },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
]

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <button
          type="button"
          onClick={() => navigate('/admin/users')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-surface-raised"
        >
          <Users className="h-3.5 w-3.5" />
          Manage Users
        </button>
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
              tab === id
                ? 'bg-accent-surface text-accent font-medium'
                : 'text-foreground-muted hover:bg-control hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'files' && <FileBrowserTab />}
      {tab === 'indexing' && <IndexingTab />}
      {tab === 'maintenance' && <MaintenanceTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab() {
  const { data: stats, error, isLoading, refetch } = useFetch(() => api.adminStats(), [])
  const { data: pathsData, refetch: refetchPaths } = useFetch(() => api.adminPaths(), [])

  useAutoRefresh(['mediaItem', 'file', 'feature', 'person', 'place', 'keyword'], () => {
    refetch()
    refetchPaths()
  })

  if (error)
    return <FetchError message={`Failed to load stats: ${error.message}`} onRetry={refetch} />

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard icon={Image} label="Images" value={stats.images} />
        <StatCard icon={Video} label="Videos" value={stats.videos} />
        <StatCard icon={Database} label="Media Items" value={stats.mediaItems} />
        <StatCard icon={File} label="Files" value={stats.files} />
        <StatCard icon={Shield} label="Faces" value={stats.features} />
        <StatCard icon={Users} label="People" value={stats.people} />
        <StatCard icon={HardDrive} label="Indexed Paths" value={stats.paths} />
        <StatCard icon={Activity} label="Matches" value={stats.matches} />
      </div>

      {pathsData && pathsData.paths.length > 0 && (
        <SectionCard title="Indexed Paths">
          <div className="space-y-2">
            {pathsData.paths.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span className="truncate font-mono text-foreground-secondary">{p.dir}</span>
                <span className="shrink-0 text-foreground-muted">
                  {p.fileCount} file{p.fileCount !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-surface">
        <Icon className="h-5 w-5 text-accent" />
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-xs text-foreground-muted">{label}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

function SettingsTab() {
  const { data, error, isLoading, refetch } = useFetch(() => api.adminSettings(), [])
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (error)
    return <FetchError message={`Failed to load settings: ${error.message}`} onRetry={refetch} />

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    )
  }

  const startEdit = (setting: Setting) => {
    setEditing(setting.key)
    setEditValue(setting.value ?? '')
    setSaveError(null)
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditValue('')
    setSaveError(null)
  }

  const saveSetting = async (key: string) => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.adminSetSetting(key, editValue)
      setEditing(null)
      refetch()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Server Settings"
      action={
        <button
          type="button"
          onClick={refetch}
          className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
          aria-label="Refresh settings"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
    >
      {data.settings.length === 0 ? (
        <p className="text-sm text-foreground-muted">No settings configured.</p>
      ) : (
        <div className="space-y-2">
          {data.settings.map((setting) => (
            <div key={setting.key} className="rounded-lg bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium font-mono">{setting.key}</span>
                {editing !== setting.key && (
                  <button
                    type="button"
                    onClick={() => startEdit(setting)}
                    className="shrink-0 text-xs text-accent hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editing === setting.key ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none"
                  />
                  {saveError && <p className="text-xs text-error">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveSetting(setting.key)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg px-3 py-1 text-xs text-foreground-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 truncate text-sm text-foreground-muted font-mono">
                  {setting.value || <span className="italic text-foreground-faint">(empty)</span>}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// File Browser Tab
// ---------------------------------------------------------------------------

function FileBrowserTab() {
  const [currentPath, setCurrentPath] = useState('/')
  const {
    data: entries,
    error,
    isLoading,
    refetch,
  } = useFetch(() => api.adminDir(currentPath), [currentPath])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<string | null>(null)

  const navigateTo = (path: string) => {
    setCurrentPath(path)
    setUploadResult(null)
  }

  const navigateUp = () => {
    const parts = currentPath.split('/')
    parts.pop()
    const parent = parts.join('/') || '/'
    navigateTo(parent)
  }

  const handleUpload = async (files: FileList) => {
    setUploading(true)
    setUploadResult(null)
    try {
      const result = await api.adminUpload(currentPath, Array.from(files))
      setUploadResult(`Uploaded ${result.uploaded.length} file(s)`)
      refetch()
    } catch (err) {
      setUploadResult(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const breadcrumbs = currentPath === '/' ? ['/'] : currentPath.split('/').filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 overflow-x-auto text-sm">
          <button
            type="button"
            onClick={() => navigateTo('/')}
            className="shrink-0 text-foreground-muted hover:text-foreground transition-colors"
          >
            /
          </button>
          {breadcrumbs.map((segment, i) => {
            if (segment === '/') return null
            const path = `/${breadcrumbs.slice(0, i + 1).join('/')}`
            const isLast = i === breadcrumbs.length - 1
            return (
              <span key={path} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                {isLast ? (
                  <span className="font-medium text-foreground">{segment}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigateTo(path)}
                    className="text-foreground-muted hover:text-foreground transition-colors"
                  >
                    {segment}
                  </button>
                )}
              </span>
            )
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleUpload(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload
          </button>
        </div>
      </div>

      {uploadResult && <p className="text-xs text-foreground-muted">{uploadResult}</p>}

      {error && (
        <FetchError message={`Failed to browse directory: ${error.message}`} onRetry={refetch} />
      )}

      {isLoading && (
        <div className="space-y-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-surface" />
          ))}
        </div>
      )}

      {!isLoading && !error && entries && (
        <div className="rounded-xl border border-border bg-surface">
          {currentPath !== '/' && (
            <button
              type="button"
              onClick={navigateUp}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-sm text-foreground-muted transition-colors hover:bg-surface-raised"
            >
              <Folder className="h-4 w-4" />
              ..
            </button>
          )}
          {entries.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-foreground-muted">Empty directory</p>
          )}
          {entries.map((entry) => (
            <DirEntryRow key={entry.path} entry={entry} onNavigate={navigateTo} />
          ))}
        </div>
      )}
    </div>
  )
}

function DirEntryRow({
  entry,
  onNavigate,
}: {
  entry: DirEntry
  onNavigate: (path: string) => void
}) {
  if (entry.type === 'directory') {
    return (
      <button
        type="button"
        onClick={() => onNavigate(entry.path)}
        className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-surface-raised"
      >
        <Folder className="h-4 w-4 text-accent" />
        <span className="truncate">{entry.name}</span>
      </button>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
      <div className="flex items-center gap-3 min-w-0">
        <File className="h-4 w-4 shrink-0 text-foreground-muted" />
        <span className="truncate">{entry.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {entry.size != null && (
          <span className="text-xs text-foreground-faint">{formatBytes(entry.size)}</span>
        )}
        <a
          href={api.adminDownloadUrl(entry.path)}
          className="rounded p-1 text-foreground-muted transition-colors hover:text-foreground"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

// ---------------------------------------------------------------------------
// Indexing Tab
// ---------------------------------------------------------------------------

function IndexingTab() {
  const { data: pathsData, refetch: refetchPaths } = useFetch(() => api.adminPaths(), [])
  const [directory, setDirectory] = useState('')
  const [concurrency, setConcurrency] = useState('4')
  const [indexStatus, setIndexStatus] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [reindexing, setReindexing] = useState(false)

  const { indexingProgress } = useNotifications()
  useAutoRefresh(['mediaItem', 'file'], refetchPaths)

  const startIndex = async () => {
    if (!directory.trim()) return
    setStarting(true)
    setIndexStatus(null)
    try {
      const result = await api.adminIndex(directory.trim(), Number(concurrency) || 4)
      setIndexStatus(`Indexing started: ${result.directory} (concurrency: ${result.concurrency})`)
    } catch (err) {
      setIndexStatus(err instanceof Error ? err.message : 'Failed to start indexing')
    } finally {
      setStarting(false)
    }
  }

  const startReindex = async () => {
    setReindexing(true)
    setIndexStatus(null)
    try {
      const result = await api.adminReindex()
      if (result.status === 'no_paths') {
        setIndexStatus(result.message ?? 'No paths to re-index')
      } else {
        setIndexStatus(`Re-indexing started: ${result.directories?.length ?? 0} directories`)
      }
    } catch (err) {
      setIndexStatus(err instanceof Error ? err.message : 'Failed to start re-indexing')
    } finally {
      setReindexing(false)
    }
  }

  const isIndexing = indexingProgress !== null && indexingProgress.current < indexingProgress.total

  return (
    <div className="space-y-6">
      {indexingProgress && (
        <SectionCard title="Indexing Progress">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground-muted">
                {indexingProgress.current >= indexingProgress.total
                  ? 'Complete'
                  : `Processing: ${indexingProgress.current} / ${indexingProgress.total}`}
              </span>
              <span className="font-medium tabular-nums">
                {indexingProgress.total > 0
                  ? `${Math.round((indexingProgress.current / indexingProgress.total) * 100)}%`
                  : '0%'}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{
                  width: `${
                    indexingProgress.total > 0
                      ? Math.round((indexingProgress.current / indexingProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Index New Directory">
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground-secondary"
              htmlFor="admin-index-dir"
            >
              Directory Path
            </label>
            <input
              id="admin-index-dir"
              type="text"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="/path/to/media"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono placeholder:text-foreground-faint focus:border-accent focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-foreground-secondary"
              htmlFor="admin-index-conc"
            >
              Concurrency
            </label>
            <input
              id="admin-index-conc"
              type="number"
              min={1}
              max={32}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={startIndex}
            disabled={starting || !directory.trim() || isIndexing}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start Indexing
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Re-index Existing Paths"
        action={
          <button
            type="button"
            onClick={startReindex}
            disabled={reindexing || isIndexing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            {reindexing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Re-index All
          </button>
        }
      >
        {pathsData && pathsData.paths.length > 0 ? (
          <div className="space-y-2">
            {pathsData.paths.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm"
              >
                <span className="truncate font-mono text-foreground-secondary">{p.dir}</span>
                <span className="shrink-0 text-foreground-muted">
                  {p.fileCount} file{p.fileCount !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">No paths indexed yet.</p>
        )}
      </SectionCard>

      {indexStatus && (
        <div className="rounded-lg bg-accent-surface px-4 py-3 text-sm text-accent">
          {indexStatus}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Maintenance Tab
// ---------------------------------------------------------------------------

interface DedupResult {
  status: string
  duplicateGroups: number
  mergedMediaItems: number
  removedMediaItems: number
}

interface OrphanResult {
  status: string
  mediaMatches: number
  featureMatches: number
  keywords: number
  persons: number
  places: number
  folders: number
}

function MaintenanceTab() {
  const [deduplicating, setDeduplicating] = useState(false)
  const [dedupResult, setDedupResult] = useState<DedupResult | null>(null)
  const [dedupError, setDedupError] = useState<string | null>(null)

  const [cleaningOrphans, setCleaningOrphans] = useState(false)
  const [orphanResult, setOrphanResult] = useState<OrphanResult | null>(null)
  const [orphanError, setOrphanError] = useState<string | null>(null)

  const runDedup = async () => {
    setDeduplicating(true)
    setDedupResult(null)
    setDedupError(null)
    try {
      const result = await api.adminDeduplicate()
      setDedupResult(result)
    } catch (err) {
      setDedupError(err instanceof Error ? err.message : 'Deduplication failed')
    } finally {
      setDeduplicating(false)
    }
  }

  const runOrphanCleanup = async () => {
    setCleaningOrphans(true)
    setOrphanResult(null)
    setOrphanError(null)
    try {
      const result = await api.adminCleanOrphans()
      setOrphanResult(result)
    } catch (err) {
      setOrphanError(err instanceof Error ? err.message : 'Orphan cleanup failed')
    } finally {
      setCleaningOrphans(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Deduplicate Media Items"
        action={
          <button
            type="button"
            onClick={runDedup}
            disabled={deduplicating || cleaningOrphans}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {deduplicating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            Run Deduplication
          </button>
        }
      >
        <p className="text-sm text-foreground-muted">
          Finds media items with identical perceptual hashes and merges them. The oldest entry is
          kept and all file links, keywords, ratings, faces, and folder entries are transferred to
          it. Duplicates are then removed.
        </p>

        {dedupError && (
          <div className="mt-3 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {dedupError}
          </div>
        )}

        {dedupResult && (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-accent-surface px-4 py-3 text-sm text-accent">
              Deduplication complete
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ResultStat label="Duplicate Groups" value={dedupResult.duplicateGroups} />
              <ResultStat label="Items Merged" value={dedupResult.mergedMediaItems} />
              <ResultStat label="Items Removed" value={dedupResult.removedMediaItems} />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Clean Orphaned Records"
        action={
          <button
            type="button"
            onClick={runOrphanCleanup}
            disabled={cleaningOrphans || deduplicating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {cleaningOrphans ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            Clean Orphans
          </button>
        }
      >
        <p className="text-sm text-foreground-muted">
          Removes database records that have lost their parent references: dangling match records,
          unused keywords, unlinked persons and places, and empty folders.
        </p>

        {orphanError && (
          <div className="mt-3 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {orphanError}
          </div>
        )}

        {orphanResult && (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-accent-surface px-4 py-3 text-sm text-accent">
              Orphan cleanup complete
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ResultStat label="Media Matches" value={orphanResult.mediaMatches} />
              <ResultStat label="Feature Matches" value={orphanResult.featureMatches} />
              <ResultStat label="Keywords" value={orphanResult.keywords} />
              <ResultStat label="Persons" value={orphanResult.persons} />
              <ResultStat label="Places" value={orphanResult.places} />
              <ResultStat label="Folders" value={orphanResult.folders} />
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-foreground-muted">{label}</p>
    </div>
  )
}
