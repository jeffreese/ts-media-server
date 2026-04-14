import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { Loader2, MapPin } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FetchError } from '~/components/fetch-error'
import { type MapMediaItem, api } from '~/lib/api'

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null)
  const navigateRef = useRef<ReturnType<typeof useNavigate>>(useNavigate())
  const [items, setItems] = useState<MapMediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchVersion, setFetchVersion] = useState(0)

  navigateRef.current = useNavigate()

  const retryFetch = useCallback(() => setFetchVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .mapMedia({ limit: 5000 })
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load map data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fetchVersion])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || items.length === 0) return

    if (clusterRef.current) {
      map.removeLayer(clusterRef.current)
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (clstr) => {
        const count = clstr.getChildCount()
        let size: 'small' | 'medium' | 'large' = 'small'
        if (count >= 100) size = 'large'
        else if (count >= 10) size = 'medium'

        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: L.point(40, 40),
        })
      },
    })

    const bounds: L.LatLngExpression[] = []

    for (const item of items) {
      const latlng: L.LatLngExpression = [item.latitude, item.longitude]
      bounds.push(latlng)

      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: 'map-media-marker',
          html: `<img src="${api.imageUrl(item.id, 150)}" alt="" />`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
      })

      const popupContent = document.createElement('div')
      popupContent.className = 'map-popup'

      const img = document.createElement('img')
      img.src = api.imageUrl(item.id, 300)
      img.alt = item.name ?? ''

      const p = document.createElement('p')
      p.textContent = item.name ?? 'Untitled'

      popupContent.append(img, p)
      popupContent.addEventListener('click', () => {
        navigateRef.current(`/media/${item.id}`)
      })

      marker.bindPopup(popupContent, {
        minWidth: 200,
        maxWidth: 280,
        className: 'map-media-popup',
      })

      cluster.addLayer(marker)
    }

    map.addLayer(cluster)
    clusterRef.current = cluster

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 15 })
    }
  }, [items])

  if (error) {
    return <FetchError message={`Failed to load map: ${error}`} onRetry={retryFetch} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-4">
        <h1 className="text-xl font-semibold">Map</h1>
        {!loading && (
          <span className="text-sm text-foreground-muted">
            {items.length} GPS-tagged item{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden rounded-xl border border-border">
        {loading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-surface/80">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-surface/80">
            <MapPin className="h-12 w-12 text-foreground-faint" />
            <p className="text-foreground-muted">No GPS-tagged media found</p>
            <p className="max-w-xs text-center text-sm text-foreground-faint">
              Photos with GPS coordinates in their metadata will appear here automatically.
            </p>
          </div>
        )}
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
