import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FFmpeg } from '../../src/utils/ffmpeg.js';

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
// Tests
// ---------------------------------------------------------------------------

describe('test ffmpeg command', () => {
  let ffmpeg: FFmpeg;

  beforeEach(() => {
    mockExecFile.mockReset();
    ffmpeg = new FFmpeg();
  });

  describe('getVersion', () => {
    it('returns the first line of ffmpeg -version output', async () => {
      succeedWith('ffmpeg version 7.1 Copyright (c) 2000-2024\nconfiguration: --enable-gpl\n');

      const version = await ffmpeg.getVersion();

      expect(version).toBe('ffmpeg version 7.1 Copyright (c) 2000-2024');
      expect(mockExecFile.mock.calls[0][0]).toBe('ffmpeg');
      expect(mockExecFile.mock.calls[0][1]).toEqual(['-version']);
    });

    it('trims whitespace from version output', async () => {
      succeedWith('  ffmpeg version 6.1  \n');

      const version = await ffmpeg.getVersion();

      expect(version).toBe('ffmpeg version 6.1');
    });

    it('handles single-line output', async () => {
      succeedWith('ffmpeg version 5.0');

      const version = await ffmpeg.getVersion();

      expect(version).toBe('ffmpeg version 5.0');
    });

    it('throws when ffmpeg is unreachable', async () => {
      failWith('ENOENT');

      await expect(ffmpeg.getVersion()).rejects.toThrow('ENOENT');
    });

    it('uses custom ffmpeg path', async () => {
      const custom = new FFmpeg({ ffmpegPath: '/opt/bin/ffmpeg' });
      succeedWith('ffmpeg version 7.1');

      await custom.getVersion();

      expect(mockExecFile.mock.calls[0][0]).toBe('/opt/bin/ffmpeg');
    });
  });

  describe('test ffmpeg workflow', () => {
    it('validates and gets version in sequence', async () => {
      succeedWith('ffmpeg version 7.1');
      succeedWith('ffprobe version 7.1');
      succeedWith('ffmpeg version 7.1 Copyright (c) 2000-2024\nbuilt with clang\n');

      await ffmpeg.validate();
      const version = await ffmpeg.getVersion();

      expect(version).toBe('ffmpeg version 7.1 Copyright (c) 2000-2024');
      expect(mockExecFile).toHaveBeenCalledTimes(3);
    });

    it('reports binary paths', () => {
      expect(ffmpeg.ffmpegPath).toBe('ffmpeg');
      expect(ffmpeg.ffprobePath).toBe('ffprobe');

      const custom = new FFmpeg({
        ffmpegPath: '/usr/local/bin/ffmpeg',
        ffprobePath: '/usr/local/bin/ffprobe',
      });
      expect(custom.ffmpegPath).toBe('/usr/local/bin/ffmpeg');
      expect(custom.ffprobePath).toBe('/usr/local/bin/ffprobe');
    });
  });
});

describe('test metadata command', () => {
  it('extractMetadata is importable and callable', async () => {
    const { extractMetadata } = await import('../../src/services/metadata.js');
    expect(typeof extractMetadata).toBe('function');
  });

  it('toWktPoint formats GPS as WKT POINT string', async () => {
    const { toWktPoint } = await import('../../src/services/metadata.js');

    const wkt = toWktPoint({
      latitude: 37.7749,
      longitude: -122.4194,
      datum: 'WGS-84',
      azimuth: undefined,
    });

    expect(wkt).toBe('POINT(-122.4194 37.7749)');
  });

  it('formatShutterSpeed handles various exposure times', async () => {
    const { formatShutterSpeed } = await import('../../src/services/metadata.js');

    expect(formatShutterSpeed(1 / 250)).toBe('1/250s');
    expect(formatShutterSpeed(1 / 60)).toBe('1/60s');
    expect(formatShutterSpeed(2)).toBe('2s');
    expect(formatShutterSpeed(undefined)).toBeUndefined();
  });
});

describe('test faces command', () => {
  it('detectFaces is importable', async () => {
    const { detectFaces } = await import('../../src/services/face-detection.js');
    expect(typeof detectFaces).toBe('function');
  });

  it('loadModel is importable', async () => {
    const { loadModel } = await import('../../src/services/onnx-models.js');
    expect(typeof loadModel).toBe('function');
  });

  it('loadModel rejects for non-.onnx path', async () => {
    const { loadModel } = await import('../../src/services/onnx-models.js');

    await expect(loadModel('/some/model.bin', 'Test')).rejects.toThrow(
      /must have .onnx extension/,
    );
  });

  it('loadModel rejects for missing file', async () => {
    const { loadModel } = await import('../../src/services/onnx-models.js');

    await expect(loadModel('/nonexistent/model.onnx', 'Test')).rejects.toThrow(
      /not found at/,
    );
  });
});
