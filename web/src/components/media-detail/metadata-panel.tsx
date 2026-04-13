import { Aperture, Calendar, Camera, Gauge, MapPin, Ruler, Timer } from 'lucide-react'
import { SectionCard } from '~/components/primitives'

interface MetadataPanelProps {
  info: unknown
  startDate: string | null
  endDate: string | null
}

interface InfoData {
  cameraMake?: string
  cameraModel?: string
  lensMake?: string
  lensModel?: string
  focalLength?: number
  aperture?: number
  fStop?: number
  shutterSpeed?: string
  exposureTime?: number
  iso?: number
  width?: number
  height?: number
  latitude?: number
  longitude?: number
  duration?: number
  frameRate?: number
}

function parseInfo(info: unknown): InfoData {
  if (!info || typeof info !== 'object') return {}
  const obj = info as Record<string, unknown>

  return {
    cameraMake: typeof obj.cameraMake === 'string' ? obj.cameraMake : undefined,
    cameraModel: typeof obj.cameraModel === 'string' ? obj.cameraModel : undefined,
    lensMake: typeof obj.lensMake === 'string' ? obj.lensMake : undefined,
    lensModel: typeof obj.lensModel === 'string' ? obj.lensModel : undefined,
    focalLength: typeof obj.focalLength === 'number' ? obj.focalLength : undefined,
    aperture: typeof obj.aperture === 'number' ? obj.aperture : undefined,
    fStop: typeof obj.fStop === 'number' ? obj.fStop : undefined,
    shutterSpeed: typeof obj.shutterSpeed === 'string' ? obj.shutterSpeed : undefined,
    exposureTime: typeof obj.exposureTime === 'number' ? obj.exposureTime : undefined,
    iso: typeof obj.iso === 'number' ? obj.iso : undefined,
    width: typeof obj.width === 'number' ? obj.width : undefined,
    height: typeof obj.height === 'number' ? obj.height : undefined,
    latitude: typeof obj.latitude === 'number' ? obj.latitude : undefined,
    longitude: typeof obj.longitude === 'number' ? obj.longitude : undefined,
    duration: typeof obj.duration === 'number' ? obj.duration : undefined,
    frameRate: typeof obj.frameRate === 'number' ? obj.frameRate : undefined,
  }
}

export function MetadataPanel({ info, startDate, endDate }: MetadataPanelProps) {
  const data = parseInfo(info)
  const hasCamera = data.cameraMake || data.cameraModel
  const hasLens = data.lensMake || data.lensModel
  const hasExposure =
    data.focalLength || data.aperture || data.fStop || data.shutterSpeed || data.iso
  const hasDimensions = data.width && data.height
  const hasGps = data.latitude != null && data.longitude != null
  const hasVideo = data.duration != null
  const hasAnything =
    hasCamera || hasLens || hasExposure || hasDimensions || hasGps || hasVideo || startDate

  if (!hasAnything) return null

  return (
    <SectionCard title="Details">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {startDate && (
          <MetaRow icon={Calendar} label="Date" value={formatDate(startDate, endDate)} />
        )}

        {hasCamera && (
          <MetaRow
            icon={Camera}
            label="Camera"
            value={[data.cameraMake, data.cameraModel].filter(Boolean).join(' ')}
          />
        )}

        {hasLens && (
          <MetaRow
            icon={Camera}
            label="Lens"
            value={[data.lensMake, data.lensModel].filter(Boolean).join(' ')}
          />
        )}

        {hasExposure && <MetaRow icon={Aperture} label="Exposure" value={formatExposure(data)} />}

        {data.iso != null && <MetaRow icon={Gauge} label="ISO" value={String(data.iso)} />}

        {hasDimensions && (
          <MetaRow icon={Ruler} label="Dimensions" value={`${data.width} × ${data.height}`} />
        )}

        {hasGps && (
          <MetaRow
            icon={MapPin}
            label="Location"
            value={`${data.latitude?.toFixed(6)}, ${data.longitude?.toFixed(6)}`}
          />
        )}

        {hasVideo && data.duration != null && (
          <MetaRow icon={Timer} label="Duration" value={formatDuration(data.duration)} />
        )}

        {data.frameRate != null && (
          <MetaRow icon={Timer} label="Frame Rate" value={`${data.frameRate} fps`} />
        )}
      </dl>
    </SectionCard>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Camera
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-faint" />
      <div>
        <dt className="text-foreground-muted">{label}</dt>
        <dd className="text-foreground">{value}</dd>
      </div>
    </div>
  )
}

function formatExposure(data: InfoData): string {
  const parts: string[] = []
  if (data.focalLength) parts.push(`${data.focalLength}mm`)
  if (data.fStop) parts.push(`f/${data.fStop}`)
  else if (data.aperture) parts.push(`f/${data.aperture}`)
  if (data.shutterSpeed) parts.push(data.shutterSpeed)
  else if (data.exposureTime) parts.push(`${data.exposureTime}s`)
  return parts.join('  ·  ')
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDate(start: string, end: string | null): string {
  if (!end || end === start) return start
  return `${start} — ${end}`
}
