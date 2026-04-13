const API_BASE = ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body || res.statusText)
  }

  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Index / folder browsing
// ---------------------------------------------------------------------------

export interface FolderEntry {
  id: number
  name: string
  description: string | null
  parentId: number | null
  info: unknown
}

export interface MediaItemEntry {
  id: number
  name: string | null
  description: string | null
  type: string | null
  startDate: string | null
  endDate: string | null
  info: unknown
  folderEntryIndex: number | null
}

export interface IndexResponse {
  path: string
  folderId: number | null
  folders: FolderEntry[]
  items: MediaItemEntry[]
  offset: number
  limit: number
  total: number
}

// ---------------------------------------------------------------------------
// Media item detail
// ---------------------------------------------------------------------------

export interface MediaItemDetail {
  id: number
  name: string | null
  description: string | null
  type: string | null
  startDate: string | null
  endDate: string | null
  hash: string | null
  info: unknown
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface Person {
  id: number
  info: unknown
}

export interface PersonName {
  id: number
  personId: number
  name: string
  preferred: boolean
}

export interface PersonFeature {
  id: number
  featureId: number
  personId: number
  info: unknown
  itemId: number
  label: string | null
}

export interface PaginatedResponse<T> {
  items: T[]
  offset: number
  limit: number
  total: number
}

// ---------------------------------------------------------------------------
// Matching faces
// ---------------------------------------------------------------------------

export interface MatchingFace {
  featureId: number
  mediaItemId: number
  similarity: number
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  index(path = '', options?: { recursive?: boolean; offset?: number; limit?: number }) {
    const params = new URLSearchParams()
    if (options?.recursive) params.set('recursive', 'true')
    if (options?.offset != null) params.set('offset', String(options.offset))
    if (options?.limit != null) params.set('limit', String(options.limit))
    const query = params.toString()
    const url = path ? `/index/${path}` : '/index'
    return request<IndexResponse>(`${url}${query ? `?${query}` : ''}`)
  },

  mediaItem(id: number) {
    return request<MediaItemDetail>(`/mediaItem/${id}`)
  },

  thumbnailWidths(id: number) {
    return request<{ widths: number[] }>(`/thumbnails/${id}`)
  },

  people(options?: { offset?: number; limit?: number }) {
    const params = new URLSearchParams()
    if (options?.offset != null) params.set('offset', String(options.offset))
    if (options?.limit != null) params.set('limit', String(options.limit))
    const query = params.toString()
    return request<PaginatedResponse<Person>>(`/person${query ? `?${query}` : ''}`)
  },

  personNames(personId: number) {
    return request<PaginatedResponse<PersonName>>(`/person/${personId}/names`)
  },

  personFeatures(personId: number, options?: { offset?: number; limit?: number }) {
    const params = new URLSearchParams()
    if (options?.offset != null) params.set('offset', String(options.offset))
    if (options?.limit != null) params.set('limit', String(options.limit))
    const query = params.toString()
    return request<PaginatedResponse<PersonFeature>>(`/person/${personId}/features${query ? `?${query}` : ''}`)
  },

  matchingFaces(featureId: number, options?: { offset?: number; limit?: number }) {
    const params = new URLSearchParams()
    if (options?.offset != null) params.set('offset', String(options.offset))
    if (options?.limit != null) params.set('limit', String(options.limit))
    const query = params.toString()
    return request<PaginatedResponse<MatchingFace>>(`/matchingFaces/${featureId}${query ? `?${query}` : ''}`)
  },

  imageUrl(id: number, width?: number) {
    const params = width ? `?width=${width}` : ''
    return `${API_BASE}/image/${id}${params}`
  },

  videoUrl(id: number) {
    return `${API_BASE}/video/${id}`
  },

  faceUrl(id: number) {
    return `${API_BASE}/face/${id}`
  },
}
