import * as ort from 'onnxruntime-node';
import type sharp from 'sharp';
import { getDimensions, resize, toRawPixelBuffer } from '../utils/image.js';
import type { FaceLandmarks } from './face-detection.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECOGNITION_INPUT_SIZE = 112;

const DEFAULT_SIMILARITY_THRESHOLD = 0.363;

/**
 * Canonical landmark positions for a 112x112 aligned face.
 * Standard ArcFace/SFace reference coordinates (insightface convention).
 * Order: left eye, right eye, nose tip, left mouth corner, right mouth corner.
 */
const REFERENCE_LANDMARKS: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

// Re-export for convenience — callers don't need to import face-detection
// just to get the landmark type.
export type { FaceLandmarks } from './face-detection.js';

// ---------------------------------------------------------------------------
// Affine alignment
// ---------------------------------------------------------------------------

/**
 * Estimate a similarity transform (rotation + uniform scale + translation)
 * from source landmarks to reference landmarks using least-squares.
 *
 * Returns the 2x3 affine matrix [[a, -b, tx], [b, a, ty]].
 */
export function estimateSimilarityTransform(
  src: [number, number][],
  dst: [number, number][],
): [number, number, number, number, number, number] {
  const n = src.length;

  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0];
    srcMeanY += src[i][1];
    dstMeanX += dst[i][0];
    dstMeanY += dst[i][1];
  }
  srcMeanX /= n;
  srcMeanY /= n;
  dstMeanX /= n;
  dstMeanY /= n;

  let num1 = 0, num2 = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;

    num1 += dx * sx + dy * sy;
    num2 += dx * sy - dy * sx;
    denom += sx * sx + sy * sy;
  }

  const a = num1 / denom;
  const b = num2 / denom;
  const tx = dstMeanX - a * srcMeanX + b * srcMeanY;
  const ty = dstMeanY - a * srcMeanY - b * srcMeanX;

  return [a, -b, tx, b, a, ty];
}

/**
 * Apply a 2x3 affine transform to produce a 112x112 aligned face image
 * from the source pixel buffer.
 *
 * Uses inverse mapping: for each output pixel, find the corresponding
 * source pixel via the inverse transform and bilinear interpolation.
 */
export function warpAffine(
  srcBuffer: Buffer,
  srcWidth: number,
  srcHeight: number,
  channels: number,
  affine: [number, number, number, number, number, number],
): Buffer {
  const outSize = RECOGNITION_INPUT_SIZE;
  const out = Buffer.alloc(outSize * outSize * channels);

  const [a, negB, tx, b, a2, ty] = affine;
  const det = a * a2 - negB * b;
  const invA = a2 / det;
  const invB = -negB / det;
  const invC = -b / det;
  const invD = a / det;
  const invTx = -(invA * tx + invB * ty);
  const invTy = -(invC * tx + invD * ty);

  for (let dy = 0; dy < outSize; dy++) {
    for (let dx = 0; dx < outSize; dx++) {
      const srcX = invA * dx + invB * dy + invTx;
      const srcY = invC * dx + invD * dy + invTy;

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = srcX - x0;
      const fy = srcY - y0;

      for (let ch = 0; ch < channels; ch++) {
        const getPixel = (px: number, py: number): number => {
          if (px < 0 || px >= srcWidth || py < 0 || py >= srcHeight) return 0;
          return srcBuffer[(py * srcWidth + px) * channels + ch];
        };

        const v =
          getPixel(x0, y0) * (1 - fx) * (1 - fy) +
          getPixel(x1, y0) * fx * (1 - fy) +
          getPixel(x0, y1) * (1 - fx) * fy +
          getPixel(x1, y1) * fx * fy;

        out[(dy * outSize + dx) * channels + ch] = Math.round(v);
      }
    }
  }

  return out;
}

/**
 * Align and crop a face from the source image using detected landmarks.
 * Computes a similarity transform from the detected 5-point landmarks
 * to canonical reference positions, then warps to a 112x112 output.
 */
export async function alignFace(
  image: sharp.Sharp,
  landmarks: FaceLandmarks,
): Promise<Buffer> {
  const maxDim = 2048;
  const resized = resize(image, { width: maxDim, height: maxDim });
  const { buffer, width, height, channels } = await toRawPixelBuffer(resized);

  const { width: origWidth, height: origHeight } = await getDimensions(image);

  const scaleX = width / origWidth;
  const scaleY = height / origHeight;

  const srcPoints: [number, number][] = [
    [landmarks.leftEye.x * scaleX, landmarks.leftEye.y * scaleY],
    [landmarks.rightEye.x * scaleX, landmarks.rightEye.y * scaleY],
    [landmarks.noseTip.x * scaleX, landmarks.noseTip.y * scaleY],
    [landmarks.leftMouthCorner.x * scaleX, landmarks.leftMouthCorner.y * scaleY],
    [landmarks.rightMouthCorner.x * scaleX, landmarks.rightMouthCorner.y * scaleY],
  ];

  const affine = estimateSimilarityTransform(srcPoints, REFERENCE_LANDMARKS);
  return warpAffine(buffer, width, height, channels, affine);
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert a 112x112 RGB pixel buffer to a normalized NCHW float32 tensor
 * suitable for SFace/ArcFace inference.
 *
 * Normalization: (pixel - 127.5) / 128.0
 */
export function preprocessAlignedFace(rgbBuffer: Buffer): ort.Tensor {
  const size = RECOGNITION_INPUT_SIZE;
  const floats = new Float32Array(3 * size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const dstIdx = ch * size * size + y * size + x;
        floats[dstIdx] = (rgbBuffer[srcIdx + ch] - 127.5) / 128.0;
      }
    }
  }

  return new ort.Tensor('float32', floats, [1, 3, size, size]);
}

// ---------------------------------------------------------------------------
// Embedding extraction
// ---------------------------------------------------------------------------

/**
 * Extract a face embedding from an aligned face image using an SFace
 * (or compatible ArcFace) ONNX model session.
 *
 * The returned embedding is L2-normalized.
 */
export async function extractEmbedding(
  session: ort.InferenceSession,
  alignedFaceRgb: Buffer,
): Promise<Float32Array> {
  const inputTensor = preprocessAlignedFace(alignedFaceRgb);

  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });

  const outputName = session.outputNames[0];
  const outputTensor = results[outputName];
  const raw = outputTensor.data as Float32Array;

  return l2Normalize(raw);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * L2-normalize a vector, returning a new Float32Array.
 * The input is not modified.
 */
export function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  const result = new Float32Array(vec.length);
  if (norm === 0) return result;

  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i] / norm;
  }
  return result;
}

/**
 * Compute cosine similarity between two embeddings.
 * Both embeddings should be L2-normalized, so cosine similarity
 * reduces to the dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Compare two face embeddings and determine if they match.
 *
 * @returns true if cosine similarity exceeds the threshold.
 */
export function compareFaces(
  embedding1: Float32Array,
  embedding2: Float32Array,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): boolean {
  return cosineSimilarity(embedding1, embedding2) >= threshold;
}

// ---------------------------------------------------------------------------
// High-level pipeline
// ---------------------------------------------------------------------------

/**
 * Full face recognition pipeline: align a detected face, extract its
 * embedding, and return the normalized feature vector.
 *
 * @param session - An onnxruntime InferenceSession loaded with an SFace/ArcFace model.
 * @param image - A sharp instance of the source image (already auto-rotated).
 * @param landmarks - The 5-point facial landmarks from face detection.
 * @returns L2-normalized face embedding.
 */
export async function recognizeFace(
  session: ort.InferenceSession,
  image: sharp.Sharp,
  landmarks: FaceLandmarks,
): Promise<Float32Array> {
  const aligned = await alignFace(image, landmarks);
  return extractEmbedding(session, aligned);
}
