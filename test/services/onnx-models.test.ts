import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

import {
  validateModelPaths,
  loadModel,
  loadModels,
  getModelDownloadUrls,
  FACE_DETECTION_MODEL,
  FACE_RECOGNITION_MODEL,
} from '../../src/services/onnx-models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'onnx-models-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function createFakeModel(name: string): Promise<string> {
  const filePath = join(tempDir, name);
  await writeFile(filePath, Buffer.from('not-a-real-onnx-model'));
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('onnx-models service', () => {
  // -------------------------------------------------------------------------
  // validateModelPaths
  // -------------------------------------------------------------------------

  describe('validateModelPaths', () => {
    it('rejects non-.onnx extension for detection model', async () => {
      await expect(
        validateModelPaths({
          detection: '/some/path/model.bin',
          recognition: '/some/path/model.onnx',
        }),
      ).rejects.toThrow('.onnx extension');
    });

    it('rejects non-.onnx extension for recognition model', async () => {
      await expect(
        validateModelPaths({
          detection: '/some/path/model.onnx',
          recognition: '/some/path/model.pt',
        }),
      ).rejects.toThrow('.onnx extension');
    });

    it('rejects missing detection model file', async () => {
      const recognitionPath = await createFakeModel('recognition.onnx');

      await expect(
        validateModelPaths({
          detection: join(tempDir, 'nonexistent.onnx'),
          recognition: recognitionPath,
        }),
      ).rejects.toThrow('model not found');
    });

    it('rejects missing recognition model file', async () => {
      const detectionPath = await createFakeModel('detection.onnx');

      await expect(
        validateModelPaths({
          detection: detectionPath,
          recognition: join(tempDir, 'nonexistent.onnx'),
        }),
      ).rejects.toThrow('model not found');
    });

    it('passes when both model files exist with .onnx extension', async () => {
      const detectionPath = await createFakeModel('detection.onnx');
      const recognitionPath = await createFakeModel('recognition.onnx');

      await expect(
        validateModelPaths({
          detection: detectionPath,
          recognition: recognitionPath,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // loadModel
  // -------------------------------------------------------------------------

  describe('loadModel', () => {
    it('rejects non-.onnx extension', async () => {
      await expect(loadModel('/some/model.bin', 'Test')).rejects.toThrow(
        '.onnx extension',
      );
    });

    it('rejects missing file', async () => {
      await expect(
        loadModel(join(tempDir, 'missing.onnx'), 'Test'),
      ).rejects.toThrow('model not found');
    });

    it('throws a descriptive error for invalid model data', async () => {
      const fakePath = await createFakeModel('bad.onnx');

      await expect(loadModel(fakePath, 'Test')).rejects.toThrow(
        'Failed to load Test model',
      );
    });
  });

  // -------------------------------------------------------------------------
  // loadModels
  // -------------------------------------------------------------------------

  describe('loadModels', () => {
    it('throws when detection model file is invalid', async () => {
      const detectionPath = await createFakeModel('detection.onnx');
      const recognitionPath = await createFakeModel('recognition.onnx');

      await expect(
        loadModels({
          detection: detectionPath,
          recognition: recognitionPath,
        }),
      ).rejects.toThrow('Failed to load');
    });
  });

  // -------------------------------------------------------------------------
  // getModelDownloadUrls
  // -------------------------------------------------------------------------

  describe('getModelDownloadUrls', () => {
    it('returns URLs for both models', () => {
      const urls = getModelDownloadUrls();

      expect(urls[FACE_DETECTION_MODEL]).toContain('yunet');
      expect(urls[FACE_RECOGNITION_MODEL]).toContain('w600k_r50');
    });

    it('returns a new object each time (not a shared reference)', () => {
      const a = getModelDownloadUrls();
      const b = getModelDownloadUrls();

      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  describe('model constants', () => {
    it('exports expected detection model filename', () => {
      expect(FACE_DETECTION_MODEL).toBe('face_detection_yunet_2023mar.onnx');
    });

    it('exports expected recognition model filename', () => {
      expect(FACE_RECOGNITION_MODEL).toBe(
        'w600k_r50.onnx',
      );
    });
  });
});
