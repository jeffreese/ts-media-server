import * as ort from 'onnxruntime-node';
import type sharp from 'sharp';
import { getDimensions, resize, sharpen, crop, toJpegBuffer, toRawPixelBuffer } from '../utils/image.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRIDES = [8, 16, 32] as const;
const DIVISOR = 32;
const MAX_DETECTION_WIDTH = 600;
const FACE_THUMBNAIL_MAX_PX = 300;
const MAX_DETECTIONS = 20;

const DEFAULT_SCORE_THRESHOLD = 0.6;
const DEFAULT_NMS_THRESHOLD = 0.3;
const DEFAULT_TOP_K = 5000;

const OUTPUT_NAMES = [
  'cls_8', 'cls_16', 'cls_32',
  'obj_8', 'obj_16', 'obj_32',
  'bbox_8', 'bbox_16', 'bbox_32',
  'kps_8', 'kps_16', 'kps_32',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FaceLandmarks {
  rightEye: { x: number; y: number };
  leftEye: { x: number; y: number };
  noseTip: { x: number; y: number };
  rightMouthCorner: { x: number; y: number };
  leftMouthCorner: { x: number; y: number };
}

export interface FaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  landmarks: FaceLandmarks;
}

export interface FaceDetectionResult {
  detection: FaceDetection;
  thumbnail: Buffer;
}

export interface FaceDetectionOptions {
  scoreThreshold?: number;
  nmsThreshold?: number;
  topK?: number;
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

/**
 * Pad a dimension to the next multiple of DIVISOR.
 */
export function padToDivisor(value: number): number {
  return (Math.floor((value - 1) / DIVISOR) + 1) * DIVISOR;
}

/**
 * Compute the scale factor and target dimensions for detection input.
 * Resizes the image so the width is at most MAX_DETECTION_WIDTH,
 * preserving aspect ratio.
 */
export function computeDetectionSize(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  let scale = 1;
  let targetWidth = width;
  let targetHeight = height;

  if (width > MAX_DETECTION_WIDTH) {
    scale = MAX_DETECTION_WIDTH / width;
    targetWidth = MAX_DETECTION_WIDTH;
    targetHeight = Math.round(height * scale);
  }

  return { width: targetWidth, height: targetHeight, scale };
}

/**
 * Prepare the input tensor for YuNet from a sharp image.
 * Resizes to detection dimensions, pads to DIVISOR multiples,
 * and converts to NCHW float32 tensor.
 */
export async function preprocessImage(
  image: sharp.Sharp,
  targetWidth: number,
  targetHeight: number,
): Promise<{ tensor: ort.Tensor; padW: number; padH: number }> {
  const padW = padToDivisor(targetWidth);
  const padH = padToDivisor(targetHeight);

  const resized = resize(image, { width: targetWidth, height: targetHeight });
  const { buffer, width: actualW, height: actualH, channels } = await toRawPixelBuffer(resized);

  const floats = new Float32Array(3 * padH * padW);

  for (let y = 0; y < actualH; y++) {
    for (let x = 0; x < actualW; x++) {
      const srcIdx = (y * actualW + x) * channels;
      for (let ch = 0; ch < 3; ch++) {
        const dstIdx = ch * padH * padW + y * padW + x;
        floats[dstIdx] = buffer[srcIdx + ch];
      }
    }
  }

  const tensor = new ort.Tensor('float32', floats, [1, 3, padH, padW]);
  return { tensor, padW, padH };
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

interface RawDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  landmarks: [number, number, number, number, number, number, number, number, number, number];
}

/**
 * Decode raw model outputs into face detections.
 * Follows the OpenCV FaceDetectorYN post-processing logic:
 * score = sqrt(clamp(cls) * clamp(obj)), then decode bbox and landmarks
 * relative to anchor grid positions.
 */
export function decodeDetections(
  outputs: Map<string, ort.Tensor>,
  padW: number,
  padH: number,
  scoreThreshold: number,
): RawDetection[] {
  const detections: RawDetection[] = [];

  for (let i = 0; i < STRIDES.length; i++) {
    const stride = STRIDES[i];
    const cols = Math.floor(padW / stride);
    const rows = Math.floor(padH / stride);

    const clsTensor = outputs.get(OUTPUT_NAMES[i]);
    const objTensor = outputs.get(OUTPUT_NAMES[i + 3]);
    const bboxTensor = outputs.get(OUTPUT_NAMES[i + 6]);
    const kpsTensor = outputs.get(OUTPUT_NAMES[i + 9]);

    if (!clsTensor || !objTensor || !bboxTensor || !kpsTensor) {
      throw new Error(
        `Missing model output tensor for stride ${stride}. ` +
        `Expected: ${OUTPUT_NAMES[i]}, ${OUTPUT_NAMES[i + 3]}, ${OUTPUT_NAMES[i + 6]}, ${OUTPUT_NAMES[i + 9]}`,
      );
    }

    const clsData = clsTensor.data as Float32Array;
    const objData = objTensor.data as Float32Array;
    const bboxData = bboxTensor.data as Float32Array;
    const kpsData = kpsTensor.data as Float32Array;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;

        const clsScore = Math.max(0, Math.min(1, clsData[idx]));
        const objScore = Math.max(0, Math.min(1, objData[idx]));
        const score = Math.sqrt(clsScore * objScore);

        if (score < scoreThreshold) continue;

        const bboxOffset = idx * 4;
        const cx = (c + bboxData[bboxOffset]) * stride;
        const cy = (r + bboxData[bboxOffset + 1]) * stride;
        const w = Math.exp(bboxData[bboxOffset + 2]) * stride;
        const h = Math.exp(bboxData[bboxOffset + 3]) * stride;

        const x = cx - w / 2;
        const y = cy - h / 2;

        const kpsOffset = idx * 10;
        const landmarks: RawDetection['landmarks'] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let n = 0; n < 5; n++) {
          landmarks[n * 2] = (kpsData[kpsOffset + n * 2] + c) * stride;
          landmarks[n * 2 + 1] = (kpsData[kpsOffset + n * 2 + 1] + r) * stride;
        }

        detections.push({ x, y, width: w, height: h, score, landmarks });
      }
    }
  }

  return detections;
}

/**
 * Compute Intersection over Union (IoU) between two bounding boxes.
 */
export function computeIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return intersection / (areaA + areaB - intersection);
}

/**
 * Non-Maximum Suppression: keep only the highest-scoring non-overlapping
 * detections. Sorted by score descending, capped at topK.
 */
export function nms(
  detections: RawDetection[],
  nmsThreshold: number,
  topK: number,
): RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: RawDetection[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length && kept.length < topK; i++) {
    if (suppressed.has(i)) continue;

    kept.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (computeIoU(sorted[i], sorted[j]) > nmsThreshold) {
        suppressed.add(j);
      }
    }
  }

  return kept;
}

/**
 * Scale raw detections from padded detection coordinates back to
 * original image dimensions.
 */
export function scaleDetections(
  detections: RawDetection[],
  scale: number,
): FaceDetection[] {
  const invScale = scale === 0 ? 1 : 1 / scale;

  return detections.map((d) => ({
    x: d.x * invScale,
    y: d.y * invScale,
    width: d.width * invScale,
    height: d.height * invScale,
    score: d.score,
    landmarks: {
      rightEye: { x: d.landmarks[0] * invScale, y: d.landmarks[1] * invScale },
      leftEye: { x: d.landmarks[2] * invScale, y: d.landmarks[3] * invScale },
      noseTip: { x: d.landmarks[4] * invScale, y: d.landmarks[5] * invScale },
      rightMouthCorner: { x: d.landmarks[6] * invScale, y: d.landmarks[7] * invScale },
      leftMouthCorner: { x: d.landmarks[8] * invScale, y: d.landmarks[9] * invScale },
    },
  }));
}

// ---------------------------------------------------------------------------
// Face thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a JPEG thumbnail crop for a detected face.
 * Expands the bounding box by 30% on each side for context,
 * clamps to image bounds, and resizes to at most FACE_THUMBNAIL_MAX_PX.
 */
export async function generateFaceThumbnail(
  image: sharp.Sharp,
  detection: FaceDetection,
  imageWidth: number,
  imageHeight: number,
): Promise<Buffer> {
  const padding = 0.3;
  const padX = detection.width * padding;
  const padY = detection.height * padding;

  const left = Math.max(0, Math.round(detection.x - padX));
  const top = Math.max(0, Math.round(detection.y - padY));
  const right = Math.min(imageWidth, Math.round(detection.x + detection.width + padX));
  const bottom = Math.min(imageHeight, Math.round(detection.y + detection.height + padY));

  const cropWidth = right - left;
  const cropHeight = bottom - top;

  if (cropWidth <= 0 || cropHeight <= 0) {
    return Buffer.alloc(0);
  }

  const cropped = crop(image, { left, top, width: cropWidth, height: cropHeight });
  const resized = resize(cropped, {
    width: FACE_THUMBNAIL_MAX_PX,
    height: FACE_THUMBNAIL_MAX_PX,
  });

  return toJpegBuffer(sharpen(resized), { quality: 100 });
}

// ---------------------------------------------------------------------------
// Main detection pipeline
// ---------------------------------------------------------------------------

/**
 * Detect faces in an image using a YuNet ONNX model session.
 *
 * Pipeline:
 * 1. Resize image to ≤600px width for detection performance
 * 2. Pad to multiples of 32
 * 3. Run YuNet inference
 * 4. Decode multi-scale outputs (strides 8/16/32)
 * 5. Apply NMS
 * 6. Scale coordinates back to original dimensions
 * 7. Filter images with >20 detections (false positive heuristic)
 * 8. Generate face thumbnail crops
 *
 * @param session - An onnxruntime InferenceSession loaded with the YuNet model.
 * @param image - A sharp instance (already auto-rotated).
 * @param options - Optional score/NMS thresholds and topK.
 * @returns Array of face detections with thumbnail crops, or empty if >20 faces detected.
 */
export async function detectFaces(
  session: ort.InferenceSession,
  image: sharp.Sharp,
  options: FaceDetectionOptions = {},
): Promise<FaceDetectionResult[]> {
  const {
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    nmsThreshold = DEFAULT_NMS_THRESHOLD,
    topK = DEFAULT_TOP_K,
  } = options;

  const { width: origWidth, height: origHeight } = await getDimensions(image);
  const { width: targetWidth, height: targetHeight, scale } =
    computeDetectionSize(origWidth, origHeight);

  const { tensor, padW, padH } = await preprocessImage(image, targetWidth, targetHeight);

  const results = await session.run({ input: tensor });

  const outputMap = new Map<string, ort.Tensor>();
  for (const name of OUTPUT_NAMES) {
    outputMap.set(name, results[name]);
  }

  const rawDetections = decodeDetections(outputMap, padW, padH, scoreThreshold);
  const nmsDetections = nms(rawDetections, nmsThreshold, topK);
  const detections = scaleDetections(nmsDetections, scale);

  if (detections.length > MAX_DETECTIONS) {
    return [];
  }

  const faceResults: FaceDetectionResult[] = [];
  for (const detection of detections) {
    const thumbnail = await generateFaceThumbnail(
      image,
      detection,
      origWidth,
      origHeight,
    );
    if (thumbnail.length > 0) {
      faceResults.push({ detection, thumbnail });
    }
  }

  return faceResults;
}

/**
 * Serialize a face detection to a JSON-compatible object for database storage.
 */
export function serializeDetection(detection: FaceDetection): Record<string, unknown> {
  return {
    x: detection.x,
    y: detection.y,
    width: detection.width,
    height: detection.height,
    score: detection.score,
    landmarks: detection.landmarks,
  };
}
