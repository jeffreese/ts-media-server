import * as ort from 'onnxruntime-node';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FACE_DETECTION_MODEL = 'face_detection_yunet_2023mar.onnx';
export const FACE_RECOGNITION_MODEL = 'face_recognition_sface_2021dec.onnx';

const MODEL_DOWNLOAD_URLS: Record<string, string> = {
  [FACE_DETECTION_MODEL]:
    'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
  [FACE_RECOGNITION_MODEL]:
    'https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPaths {
  detection: string;
  recognition: string;
}

export interface OnnxModels {
  detection: ort.InferenceSession;
  recognition: ort.InferenceSession;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function assertFileExists(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    const filename = basename(path);
    const downloadUrl = MODEL_DOWNLOAD_URLS[filename] ?? 'See docs/onnx-models.md';
    throw new Error(
      `${label} model not found at: ${path}\n` +
        `Download it from: ${downloadUrl}\n` +
        `See docs/onnx-models.md for setup instructions.`,
    );
  }
}

function assertOnnxExtension(path: string, label: string): void {
  if (!path.endsWith('.onnx')) {
    throw new Error(
      `${label} model path must have .onnx extension, got: ${path}`,
    );
  }
}

/**
 * Validate that model files exist and have the correct extension.
 * Throws a descriptive error if either model is missing or misconfigured.
 */
export async function validateModelPaths(paths: ModelPaths): Promise<void> {
  assertOnnxExtension(paths.detection, 'Face detection');
  assertOnnxExtension(paths.recognition, 'Face recognition');

  await Promise.all([
    assertFileExists(paths.detection, 'Face detection'),
    assertFileExists(paths.recognition, 'Face recognition'),
  ]);
}

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

const SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
};

async function createSession(
  modelPath: string,
  label: string,
): Promise<ort.InferenceSession> {
  const resolvedPath = resolve(modelPath);

  try {
    return await ort.InferenceSession.create(resolvedPath, SESSION_OPTIONS);
  } catch (cause) {
    throw new Error(`Failed to load ${label} model from: ${resolvedPath}`, {
      cause,
    });
  }
}

/**
 * Load both face detection and recognition ONNX models into inference sessions.
 *
 * Validates that model files exist before attempting to load them.
 * Returns an object with both sessions and a `dispose()` method for cleanup.
 *
 * @param paths - Absolute or relative paths to the .onnx model files.
 */
export async function loadModels(paths: ModelPaths): Promise<OnnxModels> {
  await validateModelPaths(paths);

  const detection = await createSession(paths.detection, 'Face detection');

  let recognition: ort.InferenceSession;
  try {
    recognition = await createSession(paths.recognition, 'Face recognition');
  } catch (err) {
    await detection.release();
    throw err;
  }

  return {
    detection,
    recognition,
    async dispose() {
      await Promise.all([
        detection.release(),
        recognition.release(),
      ]);
    },
  };
}

/**
 * Load a single ONNX model session from a file path.
 * Useful for loading models individually (e.g. only detection or only recognition).
 */
export async function loadModel(
  modelPath: string,
  label = 'ONNX',
): Promise<ort.InferenceSession> {
  const resolvedPath = resolve(modelPath);
  assertOnnxExtension(resolvedPath, label);
  await assertFileExists(resolvedPath, label);
  return createSession(resolvedPath, label);
}

/**
 * Return download URLs for the recommended ONNX model files.
 */
export function getModelDownloadUrls(): Record<string, string> {
  return { ...MODEL_DOWNLOAD_URLS };
}
