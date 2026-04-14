import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FFmpeg, type VideoMetadata } from '../../src/utils/ffmpeg.js';

// ---------------------------------------------------------------------------
// Mock child_process.execFile
// ---------------------------------------------------------------------------

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const mockExecFile = vi.fn<
  [string, string[], Record<string, unknown>, ExecFileCallback]
>();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    mockExecFile(
      args[0] as string,
      args[1] as string[],
      args[2] as Record<string, unknown>,
      args[3] as ExecFileCallback,
    );
  },
}));

function succeedWith(stdout = '', stderr = ''): void {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    cb(null, stdout, stderr);
  });
}

function failWith(message: string): void {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    cb(new Error(message), '', '');
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROBE_FULL: object = {
  format: {
    duration: '120.5',
    tags: { creation_time: '2024-06-15T10:30:00.000000Z' },
  },
  streams: [
    {
      codec_type: 'video',
      width: 1920,
      height: 1080,
      r_frame_rate: '30000/1001',
    },
    { codec_type: 'audio' },
  ],
};

const PROBE_MINIMAL: object = {
  format: { duration: '5.0' },
  streams: [{ codec_type: 'video', width: 640, height: 480, r_frame_rate: '24/1' }],
};

const PROBE_NO_VIDEO_STREAM: object = {
  format: { duration: '60.0' },
  streams: [{ codec_type: 'audio' }],
};

const PROBE_STREAM_DATE: object = {
  format: { duration: '10.0' },
  streams: [
    {
      codec_type: 'video',
      width: 3840,
      height: 2160,
      r_frame_rate: '60/1',
      tags: { creation_time: '2023-12-25T08:00:00.000000Z' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FFmpeg', () => {
  let ffmpeg: FFmpeg;

  beforeEach(() => {
    mockExecFile.mockReset();
    ffmpeg = new FFmpeg();
  });

  // -------------------------------------------------------------------------
  // validate
  // -------------------------------------------------------------------------

  describe('validate', () => {
    it('succeeds when both binaries are reachable', async () => {
      succeedWith('ffmpeg version 6.1');
      succeedWith('ffprobe version 6.1');

      await expect(ffmpeg.validate()).resolves.toBeUndefined();

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile.mock.calls[0][0]).toBe('ffmpeg');
      expect(mockExecFile.mock.calls[0][1]).toEqual(['-version']);
      expect(mockExecFile.mock.calls[1][0]).toBe('ffprobe');
      expect(mockExecFile.mock.calls[1][1]).toEqual(['-version']);
    });

    it('throws when ffmpeg is not found', async () => {
      failWith('ENOENT');

      await expect(ffmpeg.validate()).rejects.toThrow(/FFmpeg not found/);
    });

    it('throws when ffprobe is not found', async () => {
      succeedWith('ffmpeg version 6.1');
      failWith('ENOENT');

      await expect(ffmpeg.validate()).rejects.toThrow(/ffprobe not found/);
    });

    it('uses custom paths', async () => {
      const custom = new FFmpeg({
        ffmpegPath: '/opt/ffmpeg/bin/ffmpeg',
        ffprobePath: '/opt/ffmpeg/bin/ffprobe',
      });

      succeedWith();
      succeedWith();

      await custom.validate();

      expect(mockExecFile.mock.calls[0][0]).toBe('/opt/ffmpeg/bin/ffmpeg');
      expect(mockExecFile.mock.calls[1][0]).toBe('/opt/ffmpeg/bin/ffprobe');
    });
  });

  // -------------------------------------------------------------------------
  // createJPEG
  // -------------------------------------------------------------------------

  describe('createJPEG', () => {
    it('extracts a frame at the 4-second mark', async () => {
      succeedWith();

      await ffmpeg.createJPEG('/videos/clip.mp4', '/tmp/thumb.jpg');

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-ss');
      expect(args[args.indexOf('-ss') + 1]).toBe('4');
      expect(args).toContain('-i');
      expect(args[args.indexOf('-i') + 1]).toBe('/videos/clip.mp4');
      expect(args).toContain('-frames:v');
      expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
      expect(args[args.length - 1]).toBe('/tmp/thumb.jpg');
    });

    it('propagates ffmpeg errors', async () => {
      failWith('No such file');

      await expect(
        ffmpeg.createJPEG('/missing.mp4', '/tmp/thumb.jpg'),
      ).rejects.toThrow('No such file');
    });
  });

  // -------------------------------------------------------------------------
  // createMP4
  // -------------------------------------------------------------------------

  describe('createMP4', () => {
    it('uses stream copy for MOV files', async () => {
      succeedWith();

      await ffmpeg.createMP4('/videos/clip.mov', '/videos/clip.mp4');

      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-c');
      expect(args[args.indexOf('-c') + 1]).toBe('copy');
      expect(args).not.toContain('-c:v');
    });

    it('uses stream copy for MOV files (case-insensitive)', async () => {
      succeedWith();

      await ffmpeg.createMP4('/videos/clip.MOV', '/videos/clip.mp4');

      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-c');
      expect(args[args.indexOf('-c') + 1]).toBe('copy');
    });

    it('uses libx264 encoding for non-MOV files', async () => {
      succeedWith();

      await ffmpeg.createMP4('/videos/clip.avi', '/videos/clip.mp4');

      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-c:v');
      expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
      expect(args).toContain('-pix_fmt');
      expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
      expect(args).toContain('-movflags');
      expect(args).toContain('-c:a');
      expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    });

    it('always includes -y for overwrite and faststart', async () => {
      succeedWith();
      await ffmpeg.createMP4('/videos/clip.mkv', '/videos/clip.mp4');

      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-y');
      expect(args).toContain('+faststart');
    });
  });

  // -------------------------------------------------------------------------
  // getMetadata
  // -------------------------------------------------------------------------

  describe('getMetadata', () => {
    it('parses full ffprobe output', async () => {
      succeedWith(JSON.stringify(PROBE_FULL));

      const meta = await ffmpeg.getMetadata('/videos/clip.mp4');

      expect(meta).toEqual<VideoMetadata>({
        date: '2024-06-15T10:30:00.000000Z',
        width: 1920,
        height: 1080,
        duration: 120.5,
        frameRate: 29.97,
      });
    });

    it('parses minimal ffprobe output', async () => {
      succeedWith(JSON.stringify(PROBE_MINIMAL));

      const meta = await ffmpeg.getMetadata('/videos/clip.mp4');

      expect(meta).toEqual<VideoMetadata>({
        date: undefined,
        width: 640,
        height: 480,
        duration: 5.0,
        frameRate: 24,
      });
    });

    it('handles missing video stream', async () => {
      succeedWith(JSON.stringify(PROBE_NO_VIDEO_STREAM));

      const meta = await ffmpeg.getMetadata('/audio/track.mp3');

      expect(meta.width).toBeUndefined();
      expect(meta.height).toBeUndefined();
      expect(meta.frameRate).toBeUndefined();
      expect(meta.duration).toBe(60.0);
    });

    it('falls back to stream-level date when format has none', async () => {
      succeedWith(JSON.stringify(PROBE_STREAM_DATE));

      const meta = await ffmpeg.getMetadata('/videos/clip.mp4');

      expect(meta.date).toBe('2023-12-25T08:00:00.000000Z');
    });

    it('calls ffprobe with correct arguments', async () => {
      succeedWith(JSON.stringify(PROBE_MINIMAL));

      await ffmpeg.getMetadata('/videos/clip.mp4');

      expect(mockExecFile.mock.calls[0][0]).toBe('ffprobe');
      expect(mockExecFile.mock.calls[0][1]).toEqual([
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '/videos/clip.mp4',
      ]);
    });

    it('propagates ffprobe errors', async () => {
      failWith('Invalid data');

      await expect(ffmpeg.getMetadata('/bad.mp4')).rejects.toThrow('Invalid data');
    });

    it('handles invalid JSON from ffprobe', async () => {
      succeedWith('not valid json');

      await expect(ffmpeg.getMetadata('/videos/clip.mp4')).rejects.toThrow();
    });

    it('treats non-numeric duration as undefined', async () => {
      succeedWith(JSON.stringify({
        format: { duration: 'N/A' },
        streams: [{ codec_type: 'video', width: 640, height: 480, r_frame_rate: '30/1' }],
      }));

      const meta = await ffmpeg.getMetadata('/videos/clip.mp4');

      expect(meta.duration).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDuration
  // -------------------------------------------------------------------------

  describe('getDuration', () => {
    it('returns duration in seconds', async () => {
      succeedWith(JSON.stringify({ format: { duration: '42.7' } }));

      const duration = await ffmpeg.getDuration('/videos/clip.mp4');

      expect(duration).toBe(42.7);
    });

    it('throws when duration is missing', async () => {
      succeedWith(JSON.stringify({ format: {} }));

      await expect(ffmpeg.getDuration('/videos/clip.mp4')).rejects.toThrow(
        /Could not determine duration/,
      );
    });

    it('throws when format is missing', async () => {
      succeedWith(JSON.stringify({}));

      await expect(ffmpeg.getDuration('/videos/clip.mp4')).rejects.toThrow(
        /Could not determine duration/,
      );
    });

    it('calls ffprobe with -show_format only', async () => {
      succeedWith(JSON.stringify({ format: { duration: '10' } }));

      await ffmpeg.getDuration('/videos/clip.mp4');

      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('-show_format');
      expect(args).not.toContain('-show_streams');
    });
  });

  // -------------------------------------------------------------------------
  // isMovie
  // -------------------------------------------------------------------------

  describe('isMovie', () => {
    it('recognizes common video extensions', () => {
      expect(ffmpeg.isMovie('clip.mp4')).toBe(true);
      expect(ffmpeg.isMovie('clip.mov')).toBe(true);
      expect(ffmpeg.isMovie('clip.mts')).toBe(true);
      expect(ffmpeg.isMovie('clip.m4v')).toBe(true);
      expect(ffmpeg.isMovie('clip.webm')).toBe(true);
      expect(ffmpeg.isMovie('clip.ogg')).toBe(true);
      expect(ffmpeg.isMovie('clip.avi')).toBe(true);
      expect(ffmpeg.isMovie('clip.mkv')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(ffmpeg.isMovie('clip.MP4')).toBe(true);
      expect(ffmpeg.isMovie('clip.MOV')).toBe(true);
      expect(ffmpeg.isMovie('clip.Mkv')).toBe(true);
    });

    it('rejects non-video extensions', () => {
      expect(ffmpeg.isMovie('photo.jpg')).toBe(false);
      expect(ffmpeg.isMovie('photo.heic')).toBe(false);
      expect(ffmpeg.isMovie('readme.txt')).toBe(false);
      expect(ffmpeg.isMovie('data.json')).toBe(false);
    });

    it('handles full paths', () => {
      expect(ffmpeg.isMovie('/videos/vacation/clip.mp4')).toBe(true);
      expect(ffmpeg.isMovie('/photos/IMG_0001.jpg')).toBe(false);
    });

    it('rejects files without extensions', () => {
      expect(ffmpeg.isMovie('noext')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getSupportedExtensions
  // -------------------------------------------------------------------------

  describe('getSupportedExtensions', () => {
    it('returns an array of extensions with leading dots', () => {
      const exts = ffmpeg.getSupportedExtensions();

      expect(exts.length).toBeGreaterThan(0);
      for (const ext of exts) {
        expect(ext).toMatch(/^\.\w+$/);
      }
    });

    it('includes common video formats', () => {
      const exts = ffmpeg.getSupportedExtensions();

      expect(exts).toContain('.mp4');
      expect(exts).toContain('.mov');
      expect(exts).toContain('.mkv');
      expect(exts).toContain('.avi');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases: missing/unreachable binaries
  // -------------------------------------------------------------------------

  describe('missing binary edge cases', () => {
    it('validate() includes path in error when ffmpeg fails', async () => {
      const custom = new FFmpeg({ ffmpegPath: '/nonexistent/ffmpeg' });
      failWith('ENOENT');

      await expect(custom.validate()).rejects.toThrow(/FFmpeg not found.*\/nonexistent\/ffmpeg/);
    });

    it('validate() includes path in error when ffprobe fails', async () => {
      const custom = new FFmpeg({ ffprobePath: '/nonexistent/ffprobe' });
      succeedWith('ffmpeg version 6.1');
      failWith('ENOENT');

      await expect(custom.validate()).rejects.toThrow(/ffprobe not found.*\/nonexistent\/ffprobe/);
    });

    it('getMetadata() propagates binary-not-found errors', async () => {
      failWith('spawn ffprobe ENOENT');

      await expect(ffmpeg.getMetadata('/some/video.mp4')).rejects.toThrow(/ENOENT/);
    });

    it('getDuration() propagates binary-not-found errors', async () => {
      failWith('spawn ffprobe ENOENT');

      await expect(ffmpeg.getDuration('/some/video.mp4')).rejects.toThrow(/ENOENT/);
    });

    it('createJPEG() propagates binary-not-found errors', async () => {
      failWith('spawn ffmpeg ENOENT');

      await expect(ffmpeg.createJPEG('/input.mp4', '/output.jpg')).rejects.toThrow(/ENOENT/);
    });

    it('createMP4() propagates binary-not-found errors', async () => {
      failWith('spawn ffmpeg ENOENT');

      await expect(ffmpeg.createMP4('/input.mkv', '/output.mp4')).rejects.toThrow(/ENOENT/);
    });

    it('isMovie works without requiring binary execution', () => {
      const custom = new FFmpeg({ ffmpegPath: '/nonexistent/ffmpeg' });
      expect(custom.isMovie('clip.mp4')).toBe(true);
      expect(custom.isMovie('photo.jpg')).toBe(false);
    });

    it('getSupportedExtensions works without requiring binary execution', () => {
      const custom = new FFmpeg({ ffmpegPath: '/nonexistent/ffmpeg' });
      expect(custom.getSupportedExtensions()).toContain('.mp4');
    });
  });
});
