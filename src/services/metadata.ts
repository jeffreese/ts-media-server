import exifr from 'exifr';
const { parse: exifrParse, gps: exifrGps } = exifr;
import { extname, dirname, join, parse as parsePath } from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { type FFmpeg, type VideoMetadata } from '../utils/ffmpeg.js';
import { isVideoExtension, isImageExtension } from '../utils/file.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Capture time derived from EXIF date tags (`DateTimeOriginal`, `CreateDate`, or `ModifyDate`).
 * `offset` is present when `OffsetTime*` tags exist on the file.
 */
export interface DateInfo {
  date: string;
  offset: string | undefined;
}

/** Camera body and lens strings from EXIF `Make` / `Model` / `LensMake` / `LensModel`. */
export interface CameraInfo {
  make: string | undefined;
  model: string | undefined;
  lensMake: string | undefined;
  lensModel: string | undefined;
}

/**
 * Exposure-related numeric tags from EXIF.
 * `aperture` is `ApertureValue` (APEX); `fStop` is `FNumber` (photographic f/-stop).
 */
export interface ExposureInfo {
  focalLength: number | undefined;
  aperture: number | undefined;
  fStop: number | undefined;
  shutterSpeed: string | undefined;
  exposureTime: number | undefined;
  iso: number | undefined;
}

/** Decimal-degrees coordinates with optional map datum and `GPSImgDirection` when available. */
export interface GpsInfo {
  latitude: number;
  longitude: number;
  datum: string | undefined;
  azimuth: number | undefined;
}

/** IPTC editorial fields merged from headline/object name, caption, keywords, and copyright tags. */
export interface IptcInfo {
  headline: string | undefined;
  caption: string | undefined;
  keywords: string[];
  copyright: string | undefined;
}

/** Normalized still-image metadata from embedded EXIF/IPTC/GPS (and sidecar JPEG when used). */
export interface ImageMetadata {
  date: DateInfo | undefined;
  camera: CameraInfo;
  exposure: ExposureInfo;
  gps: GpsInfo | undefined;
  iptc: IptcInfo;
  width: number | undefined;
  height: number | undefined;
}

/**
 * Metadata shared by images and videos after extraction.
 * Video rows fill `duration` / `frameRate` from FFmpeg; images with GPS also set `wkt` for spatial storage.
 */
export interface MediaMetadata {
  date: DateInfo | undefined;
  camera: CameraInfo;
  exposure: ExposureInfo;
  gps: GpsInfo | undefined;
  iptc: IptcInfo;
  width: number | undefined;
  height: number | undefined;
  duration: number | undefined;
  frameRate: number | undefined;
  wkt: string | undefined;
}

// ---------------------------------------------------------------------------
// EXIF tag names used across IFD blocks
// ---------------------------------------------------------------------------

const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  iptc: true,
  ifd0: {},
  translateKeys: true,
  translateValues: false,
  reviveValues: true,
  mergeOutput: false,
} as const;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseDateInfo(tags: Record<string, unknown>): DateInfo | undefined {
  const raw = tags['DateTimeOriginal'] ?? tags['CreateDate'] ?? tags['ModifyDate'];
  if (raw == null) return undefined;

  let dateStr: string;
  if (raw instanceof Date) {
    dateStr = raw.toISOString();
  } else if (typeof raw === 'string') {
    dateStr = raw;
  } else {
    return undefined;
  }

  const offset = tags['OffsetTimeOriginal'] ?? tags['OffsetTime'];
  const offsetStr = typeof offset === 'string' ? offset : undefined;

  return { date: dateStr, offset: offsetStr };
}

function parseCameraInfo(tags: Record<string, unknown>): CameraInfo {
  return {
    make: asString(tags['Make']),
    model: asString(tags['Model']),
    lensMake: asString(tags['LensMake']),
    lensModel: asString(tags['LensModel']),
  };
}

function parseExposureInfo(tags: Record<string, unknown>): ExposureInfo {
  const exposureTime = asNumber(tags['ExposureTime']);

  return {
    focalLength: asNumber(tags['FocalLength']),
    aperture: asNumber(tags['ApertureValue']),
    fStop: asNumber(tags['FNumber']),
    shutterSpeed: formatShutterSpeed(exposureTime),
    exposureTime,
    iso: asNumber(tags['ISO']) ?? asNumber(tags['ISOSpeedRatings']),
  };
}

function parseGpsInfo(
  gps: { latitude: number; longitude: number } | undefined,
  tags: Record<string, unknown>,
): GpsInfo | undefined {
  if (!gps) return undefined;
  if (!Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) return undefined;

  return {
    latitude: gps.latitude,
    longitude: gps.longitude,
    datum: asString(tags['GPSMapDatum']),
    azimuth: asNumber(tags['GPSImgDirection']),
  };
}

function parseIptcInfo(tags: Record<string, unknown>): IptcInfo {
  const rawKeywords = tags['Keywords'];
  let keywords: string[] = [];
  if (Array.isArray(rawKeywords)) {
    keywords = rawKeywords.filter((k): k is string => typeof k === 'string');
  } else if (typeof rawKeywords === 'string') {
    keywords = [rawKeywords];
  }

  return {
    headline: asString(tags['Headline'] ?? tags['ObjectName']),
    caption: asString(tags['Caption'] ?? tags['Caption-Abstract']),
    keywords,
    copyright: asString(tags['CopyrightNotice'] ?? tags['Copyright']),
  };
}

/**
 * Convert GPS coordinates to a WKT POINT string for SpatiaLite storage.
 * WKT uses longitude-first ordering: `POINT(longitude latitude)`.
 */
export function toWktPoint(gps: GpsInfo): string {
  return `POINT(${gps.longitude} ${gps.latitude})`;
}

// ---------------------------------------------------------------------------
// Value coercion helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value.trim();
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Turn EXIF `ExposureTime` (seconds) into a display string (`"2s"` or `"1/250s"`).
 *
 * @param exposureTime - Exposure duration in seconds, or `undefined` when absent.
 * @returns A human-readable shutter label, or `undefined` when `exposureTime` is absent.
 */
export function formatShutterSpeed(exposureTime: number | undefined): string | undefined {
  if (exposureTime == null) return undefined;
  if (exposureTime >= 1) return `${exposureTime}s`;
  const denominator = Math.round(1 / exposureTime);
  return `1/${denominator}s`;
}

// ---------------------------------------------------------------------------
// Sidecar JPEG lookup
// ---------------------------------------------------------------------------

const JPEG_SIDECAR_EXTENSIONS = ['.jpg', '.jpeg', '.JPG', '.JPEG'];

/**
 * Find a sidecar JPEG file with the same base name in the same directory.
 * Used as a metadata fallback for formats that lack embedded EXIF
 * (e.g. older iPad HEIC files).
 */
async function findSidecarJpeg(filePath: string): Promise<string | undefined> {
  const parsed = parsePath(filePath);
  const dir = dirname(filePath);

  for (const ext of JPEG_SIDECAR_EXTENSIONS) {
    const candidate = join(dir, `${parsed.name}${ext}`);
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

async function extractImageExif(filePath: string): Promise<{
  tags: Record<string, unknown>;
  gps: { latitude: number; longitude: number } | undefined;
}> {
  let parsed: Record<string, Record<string, unknown>> | undefined;
  try {
    parsed = await exifrParse(filePath, EXIFR_OPTIONS);
  } catch {
    return { tags: {}, gps: undefined };
  }

  if (!parsed) return { tags: {}, gps: undefined };

  const tags: Record<string, unknown> = {};
  if (typeof parsed === 'object') {
    for (const block of Object.values(parsed)) {
      if (block && typeof block === 'object') {
        Object.assign(tags, block);
      }
    }
  }

  let gps: { latitude: number; longitude: number } | undefined;
  try {
    gps = await exifrGps(filePath) ?? undefined;
  } catch {
    gps = undefined;
  }

  return { tags, gps };
}

/**
 * Extract metadata from an image file using exifr.
 * If the file has no EXIF data, attempts to read from a sidecar JPEG.
 */
export async function extractImageMetadata(filePath: string): Promise<ImageMetadata> {
  let { tags, gps } = await extractImageExif(filePath);

  const hasExif = Object.keys(tags).length > 0;
  if (!hasExif) {
    const sidecar = await findSidecarJpeg(filePath);
    if (sidecar) {
      ({ tags, gps } = await extractImageExif(sidecar));
    }
  }

  return {
    date: parseDateInfo(tags),
    camera: parseCameraInfo(tags),
    exposure: parseExposureInfo(tags),
    gps: parseGpsInfo(gps, tags),
    iptc: parseIptcInfo(tags),
    width: asNumber(tags['ImageWidth'] ?? tags['ExifImageWidth']),
    height: asNumber(tags['ImageHeight'] ?? tags['ExifImageHeight']),
  };
}

/**
 * Extract metadata from a video file using FFmpeg.
 */
export async function extractVideoMetadata(
  filePath: string,
  ffmpeg: FFmpeg,
): Promise<MediaMetadata> {
  const video: VideoMetadata = await ffmpeg.getMetadata(filePath);

  let dateInfo: DateInfo | undefined;
  if (video.date) {
    dateInfo = { date: video.date, offset: undefined };
  }

  return {
    date: dateInfo,
    camera: { make: undefined, model: undefined, lensMake: undefined, lensModel: undefined },
    exposure: {
      focalLength: undefined,
      aperture: undefined,
      fStop: undefined,
      shutterSpeed: undefined,
      exposureTime: undefined,
      iso: undefined,
    },
    gps: undefined,
    iptc: { headline: undefined, caption: undefined, keywords: [], copyright: undefined },
    width: video.width,
    height: video.height,
    duration: video.duration,
    frameRate: video.frameRate,
    wkt: undefined,
  };
}

/**
 * Extract metadata from any supported media file.
 *
 * - Images: uses exifr for EXIF/IPTC/GPS, with sidecar JPEG fallback
 * - Videos: uses FFmpeg for date, dimensions, duration, frame rate
 */
export async function extractMetadata(
  filePath: string,
  ffmpeg: FFmpeg,
): Promise<MediaMetadata> {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();

  if (isVideoExtension(ext)) {
    return extractVideoMetadata(filePath, ffmpeg);
  }

  if (isImageExtension(ext)) {
    const img = await extractImageMetadata(filePath);
    return {
      ...img,
      duration: undefined,
      frameRate: undefined,
      wkt: img.gps ? toWktPoint(img.gps) : undefined,
    };
  }

  return {
    date: undefined,
    camera: { make: undefined, model: undefined, lensMake: undefined, lensModel: undefined },
    exposure: {
      focalLength: undefined,
      aperture: undefined,
      fStop: undefined,
      shutterSpeed: undefined,
      exposureTime: undefined,
      iso: undefined,
    },
    gps: undefined,
    iptc: { headline: undefined, caption: undefined, keywords: [], copyright: undefined },
    width: undefined,
    height: undefined,
    duration: undefined,
    frameRate: undefined,
    wkt: undefined,
  };
}
