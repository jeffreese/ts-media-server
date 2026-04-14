import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Edit2,
  Loader2,
  Plus,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '~/components/empty-state'
import { FetchError } from '~/components/fetch-error'
import { LoadMoreSentinel } from '~/components/load-more-sentinel'
import { IconButton, SectionCard, Skeleton } from '~/components/primitives'
import { useAutoRefresh } from '~/hooks/use-auto-refresh'
import { useFetch } from '~/hooks/use-fetch'
import { useInfiniteScroll } from '~/hooks/use-infinite-scroll'
import {
  type GroupMember,
  type UserActivityEntry,
  type UserDetail,
  type UserGroup,
  type UserPreference,
  api,
} from '~/lib/api'

type Tab = 'users' | 'groups'

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'groups', label: 'Groups', icon: Shield },
]

const PAGE_SIZE = 50

export function AdminUsersPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('users')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Back to admin" onClick={() => navigate('/admin')}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <h1 className="text-xl font-semibold">User Management</h1>
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

      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------

function UsersTab() {
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null)
  const [expandedUser, setExpandedUser] = useState<number | null>(null)

  const fetcher = useCallback((offset: number, limit: number) => api.users({ offset, limit }), [])

  const { items, total, isLoading, isLoadingMore, error, hasMore, sentinelRef, refetch } =
    useInfiniteScroll<UserDetail>({ fetcher, pageSize: PAGE_SIZE })

  useAutoRefresh(['user', 'person', 'personName'], refetch)

  if (error) {
    return <FetchError message={`Failed to load users: ${error.message}`} onRetry={refetch} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground-muted">
          {isLoading ? '' : `${total} user${total !== 1 ? 's' : ''}`}
        </span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Create User
        </button>
      </div>

      {showCreate && (
        <CreateUserForm
          onCreated={() => {
            setShowCreate(false)
            refetch()
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editingUser && (
        <EditUserForm
          user={editingUser}
          onSaved={() => {
            setEditingUser(null)
            refetch()
          }}
          onCancel={() => setEditingUser(null)}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No users"
          description="Create a user to get started."
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border">
          {items.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              expanded={expandedUser === user.id}
              onToggleExpand={() => setExpandedUser((prev) => (prev === user.id ? null : user.id))}
              onEdit={() => setEditingUser(user)}
              onDeleted={refetch}
            />
          ))}
        </div>
      )}
      <LoadMoreSentinel sentinelRef={sentinelRef} isLoadingMore={isLoadingMore} hasMore={hasMore} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// User Row
// ---------------------------------------------------------------------------

function UserRow({
  user,
  expanded,
  onToggleExpand,
  onEdit,
  onDeleted,
}: {
  user: UserDetail
  expanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!confirm(`Delete user "${user.name ?? `User ${user.id}`}"? This cannot be undone.`)) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteUser(user.id)
      onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-3 min-w-0"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-surface text-sm font-semibold text-accent">
            {(user.name ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-medium truncate">{user.name ?? `User ${user.id}`}</p>
            <p className="text-xs text-foreground-muted">
              ID: {user.id}
              {user.status && <span className="ml-2">{user.status}</span>}
              {user.lastAccess && <span className="ml-2">Last: {user.lastAccess} UTC</span>}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-error disabled:opacity-50"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          <ChevronRight
            className={`h-4 w-4 text-foreground-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </div>

      {deleteError && <p className="px-4 pb-2 text-xs text-error">{deleteError}</p>}

      {expanded && <UserExpandedPanel userId={user.id} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expanded Panel (Preferences + Activity)
// ---------------------------------------------------------------------------

function UserExpandedPanel({ userId }: { userId: number }) {
  const [tab, setTab] = useState<'prefs' | 'activity'>('prefs')

  return (
    <div className="border-t border-border bg-background px-4 py-3 space-y-3">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setTab('prefs')}
          className={`rounded-lg px-3 py-1 text-xs transition-colors ${
            tab === 'prefs'
              ? 'bg-accent-surface text-accent font-medium'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          <Settings className="mr-1 inline h-3 w-3" />
          Preferences
        </button>
        <button
          type="button"
          onClick={() => setTab('activity')}
          className={`rounded-lg px-3 py-1 text-xs transition-colors ${
            tab === 'activity'
              ? 'bg-accent-surface text-accent font-medium'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          <Activity className="mr-1 inline h-3 w-3" />
          Activity
        </button>
      </div>

      {tab === 'prefs' && <PreferencesPanel userId={userId} />}
      {tab === 'activity' && <ActivityPanel userId={userId} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preferences Panel
// ---------------------------------------------------------------------------

function PreferencesPanel({ userId }: { userId: number }) {
  const {
    data: prefs,
    isLoading,
    error,
    refetch,
  } = useFetch(() => api.userPreferences(userId), [userId])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!newKey.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.upsertUserPreference(userId, newKey.trim(), newValue)
      setNewKey('')
      setNewValue('')
      refetch()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <p className="text-xs text-error">Failed to load preferences</p>
  if (isLoading) return <Skeleton className="h-12" />

  return (
    <div className="space-y-2">
      {prefs && prefs.length > 0 ? (
        <div className="space-y-1">
          {prefs.map((pref: UserPreference) => (
            <div
              key={pref.id}
              className="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-xs"
            >
              <span className="font-mono font-medium">{pref.key}</span>
              <span className="font-mono text-foreground-muted truncate ml-2">
                {pref.value ?? <span className="italic">(empty)</span>}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">No preferences set.</p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key"
          className="w-28 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-mono focus:border-accent focus:outline-none"
        />
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          className="flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-mono focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !newKey.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Set
        </button>
      </div>
      {saveError && <p className="text-xs text-error">{saveError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity Panel
// ---------------------------------------------------------------------------

function ActivityPanel({ userId }: { userId: number }) {
  const { data: entries, isLoading, error } = useFetch(() => api.userActivity(userId), [userId])

  if (error) return <p className="text-xs text-error">Failed to load activity</p>
  if (isLoading) return <Skeleton className="h-20" />

  if (!entries || entries.length === 0) {
    return <p className="text-xs text-foreground-muted">No activity recorded.</p>
  }

  const totalRequests = entries.reduce((sum: number, e: UserActivityEntry) => sum + e.count, 0)
  const hourBuckets = new Map<number, number>()
  for (const e of entries) {
    hourBuckets.set(e.hour, (hourBuckets.get(e.hour) ?? 0) + e.count)
  }
  const maxCount = Math.max(...hourBuckets.values())

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">
        {totalRequests.toLocaleString()} total request{totalRequests !== 1 ? 's' : ''} tracked
      </p>

      <div className="flex items-end gap-px h-16">
        {Array.from({ length: 24 }, (_, hour) => {
          const count = hourBuckets.get(hour) ?? 0
          const height = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 4 : 0) : 0
          return (
            <div key={hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div
                className="w-full rounded-sm bg-accent/70 transition-all group-hover:bg-accent"
                style={{ height: `${height}%` }}
              />
              <span className="text-[9px] text-foreground-faint">
                {hour % 6 === 0 ? `${String(hour).padStart(2, '0')}` : ''}
              </span>
              {count > 0 && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block rounded bg-surface-raised border border-border px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {hour}:00 — {count}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-foreground-faint text-center">Requests by hour (UTC)</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create User Form
// ---------------------------------------------------------------------------

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [status, setStatus] = useState('active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.createUser({
        name: name.trim(),
        ...(gender ? { gender } : {}),
        ...(birthday ? { birthday } : {}),
        ...(status ? { status } : {}),
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Create User"
      action={
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-foreground-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-3">
        <FormField label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Birthday">
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </FormField>
          <FormField label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </FormField>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Edit User Form
// ---------------------------------------------------------------------------

function EditUserForm({
  user,
  onSaved,
  onCancel,
}: {
  user: UserDetail
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(user.name ?? '')
  const [status, setStatus] = useState(user.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateUser(user.id, {
        ...(name.trim() ? { name: name.trim() } : {}),
        status,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title={`Edit User ${user.id}`}
      action={
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-foreground-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-3">
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        <FormField label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </FormField>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Groups Tab
// ---------------------------------------------------------------------------

function GroupsTab() {
  const [showCreate, setShowCreate] = useState(false)
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null)

  const fetcher = useCallback(
    (offset: number, limit: number) => api.userGroups({ offset, limit }),
    [],
  )

  const { items, total, isLoading, isLoadingMore, error, hasMore, sentinelRef, refetch } =
    useInfiniteScroll<UserGroup>({ fetcher, pageSize: PAGE_SIZE })

  useAutoRefresh(['userGroup', 'user'], refetch)

  if (error) {
    return <FetchError message={`Failed to load groups: ${error.message}`} onRetry={refetch} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground-muted">
          {isLoading ? '' : `${total} group${total !== 1 ? 's' : ''}`}
        </span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Group
        </button>
      </div>

      {showCreate && (
        <CreateGroupForm
          onCreated={() => {
            setShowCreate(false)
            refetch()
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editingGroup && (
        <EditGroupForm
          group={editingGroup}
          onSaved={() => {
            setEditingGroup(null)
            refetch()
          }}
          onCancel={() => setEditingGroup(null)}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Shield className="h-12 w-12" />}
          title="No groups"
          description="Create a group to manage team permissions."
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface divide-y divide-border">
          {items.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              expanded={expandedGroup === group.id}
              onToggleExpand={() =>
                setExpandedGroup((prev) => (prev === group.id ? null : group.id))
              }
              onEdit={() => setEditingGroup(group)}
              onDeleted={refetch}
            />
          ))}
        </div>
      )}
      <LoadMoreSentinel sentinelRef={sentinelRef} isLoadingMore={isLoadingMore} hasMore={hasMore} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group Row
// ---------------------------------------------------------------------------

function GroupRow({
  group,
  expanded,
  onToggleExpand,
  onEdit,
  onDeleted,
}: {
  group: UserGroup
  expanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteUserGroup(group.id)
      onDeleted()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex flex-1 items-center gap-3 min-w-0"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-surface">
            <Shield className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-medium truncate">{group.name}</p>
            {group.description && (
              <p className="text-xs text-foreground-muted truncate">{group.description}</p>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-foreground"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-control hover:text-error disabled:opacity-50"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
          <ChevronRight
            className={`h-4 w-4 text-foreground-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </div>

      {deleteError && <p className="px-4 pb-2 text-xs text-error">{deleteError}</p>}

      {expanded && <GroupMembersPanel groupId={group.id} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Group Members Panel
// ---------------------------------------------------------------------------

function GroupMembersPanel({ groupId }: { groupId: number }) {
  const {
    data: members,
    isLoading,
    error,
    refetch,
  } = useFetch(() => api.userGroupMembers(groupId), [groupId])
  const [addUserId, setAddUserId] = useState('')
  const [addIsAdmin, setAddIsAdmin] = useState(false)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const handleAdd = async () => {
    const uid = Number(addUserId)
    if (!uid || Number.isNaN(uid)) return
    setAdding(true)
    setActionError(null)
    try {
      await api.addGroupMember(groupId, uid, addIsAdmin)
      setAddUserId('')
      setAddIsAdmin(false)
      refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: number) => {
    setActionError(null)
    try {
      await api.removeGroupMember(groupId, userId)
      refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  if (error) return <p className="px-4 py-3 text-xs text-error">Failed to load members</p>
  if (isLoading)
    return (
      <div className="px-4 py-3">
        <Skeleton className="h-12" />
      </div>
    )

  return (
    <div className="border-t border-border bg-background px-4 py-3 space-y-3">
      <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">Members</p>

      {members && members.length > 0 ? (
        <div className="space-y-1">
          {members.map((m: GroupMember) => (
            <div
              key={m.userId}
              className="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-xs"
            >
              <span>
                User {m.userId}
                {m.isAdmin && (
                  <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-accent text-[10px] font-medium">
                    Admin
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(m.userId)}
                className="rounded p-1 text-foreground-muted hover:text-error"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">No members in this group.</p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="number"
          value={addUserId}
          onChange={(e) => setAddUserId(e.target.value)}
          placeholder="User ID"
          className="w-24 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-mono focus:border-accent focus:outline-none"
        />
        <label className="flex items-center gap-1 text-xs text-foreground-muted">
          <input
            type="checkbox"
            checked={addIsAdmin}
            onChange={(e) => setAddIsAdmin(e.target.checked)}
            className="rounded border-border"
          />
          Admin
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !addUserId}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
      </div>
      {actionError && <p className="text-xs text-error">{actionError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Group Form
// ---------------------------------------------------------------------------

function CreateGroupForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.createUserGroup({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Create Group"
      action={
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-foreground-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-3">
        <FormField label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        <FormField label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Edit Group Form
// ---------------------------------------------------------------------------

function EditGroupForm({
  group,
  onSaved,
  onCancel,
}: {
  group: UserGroup
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateUserGroup(group.id, {
        ...(name.trim() ? { name: name.trim() } : {}),
        description: description.trim() || undefined,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title={`Edit Group: ${group.name}`}
      action={
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-foreground-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-3">
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        <FormField label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </FormField>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Shared form field
// ---------------------------------------------------------------------------

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-foreground-secondary">
        {label}
        {required && <span className="text-error ml-0.5">*</span>}
      </span>
      {children}
    </div>
  )
}
