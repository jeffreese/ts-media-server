import { execFile } from 'node:child_process';
import { extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FFmpegOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface VideoMetadata {
  date: string | undefined;
  width: number | undefined;
  height: number | undefined;
  duration: number | undefined;
  frameRate: number | undefined;
}

interface FFprobeFormat {
  duration?: string;
  tags?: Record<string, string>;
}

interface FFprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  tags?: Record<string, string>;
}

interface FFprobeOutput {
  format?: FFprobeFormat;
  streams?: FFprobeStream[];
}

// ---------------------------------------------------------------------------
// Supported video extensions
// ---------------------------------------------------------------------------

const VIDEO_EXTENSIONS = new Set([
  '.mov', '.mts', '.m4v', '.mp4', '.webm', '.ogg',
  '.avi', '.wmv', '.flv', '.mkv', '.3gp',
]);

const STREAM_COPY_EXTENSIONS = new Set(['.mov']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execFileAsync(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Parse a fractional frame rate string like "30000/1001" or "30/1" into a
 * number. Returns undefined if the string is missing or unparseable.
 */
function parseFrameRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const parts = rate.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num)) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const parsed = Number(rate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Find the best creation date from ffprobe output. Checks format-level tags
 * first, then stream-level tags.
 */
function extractDate(probe: FFprobeOutput): string | undefined {
  const formatDate =
    probe.format?.tags?.['creation_time'] ??
    probe.format?.tags?.['Creation Time'] ??
    probe.format?.tags?.['date'];

  if (formatDate) return formatDate;

  for (const stream of probe.streams ?? []) {
    const streamDate =
      stream.tags?.['creation_time'] ??
      stream.tags?.['Creation Time'];
    if (streamDate) return streamDate;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// FFmpeg wrapper
// ---------------------------------------------------------------------------

export class FFmpeg {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;

  constructor(options: FFmpegOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
  }

  /**
   * Validate that ffmpeg and ffprobe are reachable by running `-version`.
   * Throws if either binary is missing or fails.
   */
  async validate(): Promise<void> {
    try {
      await execFileAsync(this.ffmpegPath, ['-version']);
    } catch {
      throw new Error(
        `FFmpeg not found at "${this.ffmpegPath}". Ensure FFmpeg is installed and the path is correct.`,
      );
    }

    try {
      await execFileAsync(this.ffprobePath, ['-version']);
    } catch {
      throw new Error(
        `ffprobe not found at "${this.ffprobePath}". Ensure FFmpeg is installed and the path is correct.`,
      );
    }
  }

  /**
   * Extract a single JPEG frame from a video at the 4-second mark.
   * If the video is shorter than 4 seconds, ffmpeg will extract the
   * last available frame.
   */
  async createJPEG(input: string, output: string): Promise<void> {
    await execFileAsync(this.ffmpegPath, [
      '-y',
      '-ss', '4',
      '-i', input,
      '-frames:v', '1',
      '-q:v', '2',
      output,
    ]);
  }

  /**
   * Transcode a video to MP4 for web streaming.
   *
   * - MOV files use stream copy (fast, lossless remux)
   * - All other formats use libx264 + yuv420p + faststart
   */
  async createMP4(input: string, output: string): Promise<void> {
    const ext = extname(input).toLowerCase();

    if (STREAM_COPY_EXTENSIONS.has(ext)) {
      await execFileAsync(this.ffmpegPath, [
        '-y',
        '-i', input,
        '-c', 'copy',
        '-movflags', '+faststart',
        output,
      ]);
    } else {
      await execFileAsync(this.ffmpegPath, [
        '-y',
        '-i', input,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        output,
      ]);
    }
  }

  /**
   * Extract metadata from a video file via ffprobe JSON output.
   */
  async getMetadata(file: string): Promise<VideoMetadata> {
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file,
    ]);

    const probe: FFprobeOutput = JSON.parse(stdout);
    const videoStream = probe.streams?.find((s) => s.codec_type === 'video');

    const rawDuration = Number(probe.format?.duration);

    return {
      date: extractDate(probe),
      width: videoStream?.width,
      height: videoStream?.height,
      duration: Number.isFinite(rawDuration) ? rawDuration : undefined,
      frameRate: parseFrameRate(videoStream?.r_frame_rate),
    };
  }

  /**
   * Extract the duration of a video file in seconds.
   */
  async getDuration(file: string): Promise<number> {
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      file,
    ]);

    const probe: FFprobeOutput = JSON.parse(stdout);
    const duration = Number(probe.format?.duration);

    if (!Number.isFinite(duration)) {
      throw new Error(`Could not determine duration for "${file}"`);
    }

    return duration;
  }

  /**
   * Check whether a file has a recognized video extension.
   */
  isMovie(file: string): boolean {
    const ext = extname(file).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  }

  /**
   * Return the list of supported video file extensions (with leading dot).
   */
  getSupportedExtensions(): string[] {
    return [...VIDEO_EXTENSIONS];
  }
}
