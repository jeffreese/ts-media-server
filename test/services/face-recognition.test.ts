import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import {
  estimateSimilarityTransform,
  warpAffine,
  alignFace,
  preprocessAlignedFace,
  extractEmbedding,
  l2Normalize,
  cosineSimilarity,
  compareFaces,
  recognizeFace,
  type FaceLandmarks,
} from '../../src/services/face-recognition.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestImage(width: number, height: number): sharp.Sharp {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).rotate();
}

function createMockSession(embeddingDim: number = 128): ort.InferenceSession {
  const embedding = new Float32Array(embeddingDim);
  for (let i = 0; i < embeddingDim; i++) {
    embedding[i] = (i % 7) * 0.1 - 0.3;
  }

  return {
    run: vi.fn().mockResolvedValue({
      output: new ort.Tensor('float32', embedding, [1, embeddingDim]),
    }),
    inputNames: ['input'],
    outputNames: ['output'],
  } as unknown as ort.InferenceSession;
}

const TEST_LANDMARKS: FaceLandmarks = {
  leftEye: { x: 180, y: 200 },
  rightEye: { x: 320, y: 200 },
  noseTip: { x: 250, y: 280 },
  leftMouthCorner: { x: 190, y: 340 },
  rightMouthCorner: { x: 310, y: 340 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('face-recognition service', () => {
  // -------------------------------------------------------------------------
  // estimateSimilarityTransform
  // -------------------------------------------------------------------------

  describe('estimateSimilarityTransform', () => {
    it('returns identity-like transform for matching points', () => {
      const pts: [number, number][] = [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
      ];

      const [a, negB, tx, b, a2, ty] = estimateSimilarityTransform(pts, pts);

      expect(a).toBeCloseTo(1, 4);
      expect(negB).toBeCloseTo(0, 4);
      expect(b).toBeCloseTo(0, 4);
      expect(a2).toBeCloseTo(1, 4);
      expect(tx).toBeCloseTo(0, 2);
      expect(ty).toBeCloseTo(0, 2);
    });

    it('computes correct scale for uniformly scaled points', () => {
      const src: [number, number][] = [
        [10, 10],
        [20, 10],
        [15, 20],
      ];
      const dst: [number, number][] = [
        [20, 20],
        [40, 20],
        [30, 40],
      ];

      const [a, negB, _tx, b, a2, _ty] = estimateSimilarityTransform(src, dst);

      expect(a).toBeCloseTo(2, 4);
      expect(negB).toBeCloseTo(0, 4);
      expect(b).toBeCloseTo(0, 4);
      expect(a2).toBeCloseTo(2, 4);
    });

    it('returns a 6-element tuple', () => {
      const pts: [number, number][] = [[0, 0], [1, 0], [0, 1]];
      const result = estimateSimilarityTransform(pts, pts);
      expect(result).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // warpAffine
  // -------------------------------------------------------------------------

  describe('warpAffine', () => {
    it('produces a 112x112 output buffer', () => {
      const srcWidth = 200;
      const srcHeight = 200;
      const channels = 3;
      const src = Buffer.alloc(srcWidth * srcHeight * channels, 128);

      const identity: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];
      const result = warpAffine(src, srcWidth, srcHeight, channels, identity);

      expect(result.length).toBe(112 * 112 * channels);
    });

    it('preserves pixel values under identity transform', () => {
      const srcWidth = 200;
      const srcHeight = 200;
      const channels = 3;
      const src = Buffer.alloc(srcWidth * srcHeight * channels, 200);

      const identity: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];
      const result = warpAffine(src, srcWidth, srcHeight, channels, identity);

      expect(result[0]).toBe(200);
      expect(result[1]).toBe(200);
      expect(result[2]).toBe(200);
    });

    it('returns zeros for pixels outside source bounds', () => {
      const srcWidth = 50;
      const srcHeight = 50;
      const channels = 3;
      const src = Buffer.alloc(srcWidth * srcHeight * channels, 255);

      const identity: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];
      const result = warpAffine(src, srcWidth, srcHeight, channels, identity);

      const lastPixelIdx = (111 * 112 + 111) * channels;
      expect(result[lastPixelIdx]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // preprocessAlignedFace
  // -------------------------------------------------------------------------

  describe('preprocessAlignedFace', () => {
    it('produces a tensor with correct NCHW shape', () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 128);
      const tensor = preprocessAlignedFace(rgb);

      expect(tensor.dims).toEqual([1, 3, 112, 112]);
      expect(tensor.type).toBe('float32');
    });

    it('normalizes pixel value 127.5 to approximately 0', () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 128);
      const tensor = preprocessAlignedFace(rgb);
      const data = tensor.data as Float32Array;

      expect(data[0]).toBeCloseTo((128 - 127.5) / 128.0, 4);
    });

    it('normalizes pixel value 0 to approximately -0.996', () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 0);
      const tensor = preprocessAlignedFace(rgb);
      const data = tensor.data as Float32Array;

      expect(data[0]).toBeCloseTo(-127.5 / 128.0, 4);
    });

    it('normalizes pixel value 255 to approximately 0.996', () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 255);
      const tensor = preprocessAlignedFace(rgb);
      const data = tensor.data as Float32Array;

      expect(data[0]).toBeCloseTo((255 - 127.5) / 128.0, 4);
    });

    it('arranges data in NCHW order (channel-first)', () => {
      const rgb = Buffer.alloc(112 * 112 * 3);
      rgb[0] = 100; // R of pixel (0,0)
      rgb[1] = 150; // G of pixel (0,0)
      rgb[2] = 200; // B of pixel (0,0)

      const tensor = preprocessAlignedFace(rgb);
      const data = tensor.data as Float32Array;

      const planeSize = 112 * 112;
      expect(data[0]).toBeCloseTo((100 - 127.5) / 128.0, 4);           // R channel
      expect(data[planeSize]).toBeCloseTo((150 - 127.5) / 128.0, 4);   // G channel
      expect(data[2 * planeSize]).toBeCloseTo((200 - 127.5) / 128.0, 4); // B channel
    });
  });

  // -------------------------------------------------------------------------
  // l2Normalize
  // -------------------------------------------------------------------------

  describe('l2Normalize', () => {
    it('normalizes a vector to unit length', () => {
      const vec = new Float32Array([3, 4]);
      const normalized = l2Normalize(vec);

      let norm = 0;
      for (let i = 0; i < normalized.length; i++) {
        norm += normalized[i] * normalized[i];
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    });

    it('returns correct components for [3, 4]', () => {
      const vec = new Float32Array([3, 4]);
      const normalized = l2Normalize(vec);

      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
    });

    it('returns zero vector for zero input', () => {
      const vec = new Float32Array([0, 0, 0]);
      const normalized = l2Normalize(vec);

      expect(normalized[0]).toBe(0);
      expect(normalized[1]).toBe(0);
      expect(normalized[2]).toBe(0);
    });

    it('does not modify the original array', () => {
      const vec = new Float32Array([3, 4]);
      l2Normalize(vec);

      expect(vec[0]).toBe(3);
      expect(vec[1]).toBe(4);
    });

    it('handles high-dimensional vectors', () => {
      const vec = new Float32Array(128);
      for (let i = 0; i < 128; i++) vec[i] = i * 0.1;

      const normalized = l2Normalize(vec);

      let norm = 0;
      for (let i = 0; i < normalized.length; i++) {
        norm += normalized[i] * normalized[i];
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
    });
  });

  // -------------------------------------------------------------------------
  // cosineSimilarity
  // -------------------------------------------------------------------------

  describe('cosineSimilarity', () => {
    it('returns 1 for identical normalized vectors', () => {
      const vec = l2Normalize(new Float32Array([1, 2, 3]));
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it('returns -1 for opposite normalized vectors', () => {
      const a = l2Normalize(new Float32Array([1, 0, 0]));
      const b = l2Normalize(new Float32Array([-1, 0, 0]));
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('returns 0 for orthogonal normalized vectors', () => {
      const a = l2Normalize(new Float32Array([1, 0, 0]));
      const b = l2Normalize(new Float32Array([0, 1, 0]));
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('throws on dimension mismatch', () => {
      const a = new Float32Array([1, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(() => cosineSimilarity(a, b)).toThrow('Embedding dimension mismatch');
    });

    it('computes correct similarity for known vectors', () => {
      const a = l2Normalize(new Float32Array([1, 2, 3]));
      const b = l2Normalize(new Float32Array([4, 5, 6]));
      // cos(a, b) = (4+10+18) / (sqrt(14) * sqrt(77))
      const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
      expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 4);
    });
  });

  // -------------------------------------------------------------------------
  // compareFaces
  // -------------------------------------------------------------------------

  describe('compareFaces', () => {
    it('returns true when similarity exceeds threshold', () => {
      const a = l2Normalize(new Float32Array([1, 2, 3]));
      const b = l2Normalize(new Float32Array([1, 2, 3.1]));
      expect(compareFaces(a, b)).toBe(true);
    });

    it('returns false when similarity is below threshold', () => {
      const a = l2Normalize(new Float32Array([1, 0, 0]));
      const b = l2Normalize(new Float32Array([0, 1, 0]));
      expect(compareFaces(a, b)).toBe(false);
    });

    it('respects custom threshold', () => {
      const a = l2Normalize(new Float32Array([1, 2, 3]));
      const b = l2Normalize(new Float32Array([4, 5, 6]));
      const similarity = cosineSimilarity(a, b);

      expect(compareFaces(a, b, similarity - 0.01)).toBe(true);
      expect(compareFaces(a, b, similarity + 0.01)).toBe(false);
    });

    it('uses default threshold of 0.363', () => {
      const a = l2Normalize(new Float32Array([1, 0, 0]));
      const b = l2Normalize(new Float32Array([0.4, 0.9, 0]));
      const similarity = cosineSimilarity(a, b);

      if (similarity >= 0.363) {
        expect(compareFaces(a, b)).toBe(true);
      } else {
        expect(compareFaces(a, b)).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // extractEmbedding (with mocked session)
  // -------------------------------------------------------------------------

  describe('extractEmbedding', () => {
    let mockSession: ort.InferenceSession;

    beforeEach(() => {
      mockSession = createMockSession();
    });

    it('returns an L2-normalized embedding', async () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 128);
      const embedding = await extractEmbedding(mockSession, rgb);

      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i] * embedding[i];
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
    });

    it('passes the correct input tensor to the session', async () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 128);
      await extractEmbedding(mockSession, rgb);

      expect(mockSession.run).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockSession.run).mock.calls[0][0] as Record<string, ort.Tensor>;
      const inputTensor = callArgs['input'];
      expect(inputTensor.dims).toEqual([1, 3, 112, 112]);
    });

    it('returns a Float32Array', async () => {
      const rgb = Buffer.alloc(112 * 112 * 3, 128);
      const embedding = await extractEmbedding(mockSession, rgb);
      expect(embedding).toBeInstanceOf(Float32Array);
    });
  });

  // -------------------------------------------------------------------------
  // alignFace
  // -------------------------------------------------------------------------

  describe('alignFace', () => {
    it('returns a buffer of 112x112x3 bytes', async () => {
      const image = createTestImage(640, 480);
      const result = await alignFace(image, TEST_LANDMARKS);

      expect(result.length).toBe(112 * 112 * 3);
    });

    it('produces non-zero output for valid landmarks', async () => {
      const image = createTestImage(640, 480);
      const result = await alignFace(image, TEST_LANDMARKS);

      let nonZero = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i] !== 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // recognizeFace (integration with mocked session)
  // -------------------------------------------------------------------------

  describe('recognizeFace', () => {
    let mockSession: ort.InferenceSession;

    beforeEach(() => {
      mockSession = createMockSession();
    });

    it('returns an L2-normalized embedding', async () => {
      const image = createTestImage(640, 480);
      const embedding = await recognizeFace(mockSession, image, TEST_LANDMARKS);

      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i] * embedding[i];
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
    });

    it('invokes the session exactly once', async () => {
      const image = createTestImage(640, 480);
      await recognizeFace(mockSession, image, TEST_LANDMARKS);

      expect(mockSession.run).toHaveBeenCalledTimes(1);
    });

    it('returns a Float32Array of the model output dimension', async () => {
      const session512 = createMockSession(512);
      const image = createTestImage(640, 480);
      const embedding = await recognizeFace(session512, image, TEST_LANDMARKS);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(512);
    });
  });
});
