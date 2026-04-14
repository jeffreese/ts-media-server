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

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null) search.set(key, String(value))
  }
  const str = search.toString()
  return str ? `?${str}` : ''
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
// Keywords
// ---------------------------------------------------------------------------

export interface Keyword {
  id: number
  word: string
}

export interface TagResult {
  id: number
  word: string
  alreadyTagged: boolean
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export interface UserRating {
  id: number
  userId: number
  itemId: number
  rating: number
  comment: string | null
  date: string | null
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

// ---------------------------------------------------------------------------
// Features (faces)
// ---------------------------------------------------------------------------

export interface Feature {
  id: number
  itemId: number
  coordinates: string | null
  label: string | null
  info: unknown
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export interface MediaMatch {
  id: number
  mediaItemId: number
  matchingItemId: number
  matchInfo: unknown
  ignoreMatch: boolean | null
}

export interface MatchingFace {
  featureId: number
  mediaItemId: number
  similarity: number
}

// ---------------------------------------------------------------------------
// Generic paginated response
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  items: T[]
  offset: number
  limit: number
  total: number
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFilters {
  q?: string
  keyword?: string
  type?: 'image' | 'video'
  dateStart?: string
  dateEnd?: string
}

export interface SearchResult {
  id: number
  name: string | null
  description: string | null
  type: string | null
  startDate: string | null
  endDate: string | null
  info: unknown
}

export interface KeywordWithCount {
  id: number
  word: string
  count: number
}

export interface KeywordItemsResponse {
  keyword: { id: number; word: string }
  items: SearchResult[]
  offset: number
  limit: number
  total: number
}

// ---------------------------------------------------------------------------
// Pagination options
// ---------------------------------------------------------------------------

interface PaginationOptions {
  offset?: number
  limit?: number
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const api = {
  // -- Folder browsing --
  index(path = '', options?: PaginationOptions & { recursive?: boolean }) {
    const query = buildQuery({
      recursive: options?.recursive,
      offset: options?.offset,
      limit: options?.limit,
    })
    const url = path ? `/index/${path}` : '/index'
    return request<IndexResponse>(`${url}${query}`)
  },

  // -- Media item --
  mediaItem(id: number) {
    return request<MediaItemDetail>(`/mediaItem/${id}`)
  },

  thumbnailWidths(id: number) {
    return request<{ widths: number[] }>(`/thumbnails/${id}`)
  },

  // -- Keywords --
  mediaItemKeywords(mediaItemId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<Keyword>>(`/mediaItem/${mediaItemId}/keywords${query}`)
  },

  addKeyword(mediaItemId: number, word: string) {
    return request<TagResult>(`/mediaItem/${mediaItemId}/keywords`, {
      method: 'POST',
      body: JSON.stringify({ word }),
    })
  },

  removeKeyword(mediaItemId: number, keywordId: number) {
    return request<{ success: boolean }>(`/mediaItem/${mediaItemId}/keywords`, {
      method: 'DELETE',
      body: JSON.stringify({ keywordId }),
    })
  },

  // -- Ratings --
  mediaItemRatings(mediaItemId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<UserRating>>(`/mediaItem/${mediaItemId}/ratings${query}`)
  },

  setRating(mediaItemId: number, rating: number, comment?: string) {
    return request<UserRating>(`/mediaItem/${mediaItemId}/rating`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    })
  },

  removeRating(mediaItemId: number) {
    return request<{ success: boolean }>(`/mediaItem/${mediaItemId}/rating`, {
      method: 'DELETE',
    })
  },

  // -- People --
  people(options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<Person>>(`/person${query}`)
  },

  personNames(personId: number) {
    return request<PaginatedResponse<PersonName>>(`/person/${personId}/names`)
  },

  personFeatures(personId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<PersonFeature>>(`/person/${personId}/features${query}`)
  },

  // -- Features (faces) for a media item --
  mediaItemFeatures(mediaItemId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<Feature>>(`/mediaItem/${mediaItemId}/features${query}`)
  },

  featurePerson(featureId: number) {
    return request<{ person: Person; names: PersonName[]; link: unknown }>(
      `/feature/${featureId}/person`,
    )
  },

  // -- Face matching --
  matchingFaces(featureId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<MatchingFace>>(`/matchingFaces/${featureId}${query}`)
  },

  // -- Duplicate matches for a media item --
  mediaItemMatches(mediaItemId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<MediaMatch>>(`/mediaItem/${mediaItemId}/matches${query}`)
  },

  // -- Search --
  search(filters: SearchFilters & PaginationOptions) {
    const query = buildQuery({
      q: filters.q,
      keyword: filters.keyword,
      type: filters.type,
      dateStart: filters.dateStart,
      dateEnd: filters.dateEnd,
      offset: filters.offset,
      limit: filters.limit,
    })
    return request<PaginatedResponse<SearchResult>>(`/search${query}`)
  },

  // -- Keywords --
  keywords(options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<PaginatedResponse<KeywordWithCount>>(`/keywords${query}`)
  },

  keywordItems(keywordId: number, options?: PaginationOptions) {
    const query = buildQuery({ offset: options?.offset, limit: options?.limit })
    return request<KeywordItemsResponse>(`/keywords/${keywordId}/items${query}`)
  },

  // -- Asset URLs --
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
