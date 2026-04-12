import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import {
  padToDivisor,
  computeDetectionSize,
  preprocessImage,
  decodeDetections,
  computeIoU,
  nms,
  scaleDetections,
  generateFaceThumbnail,
  detectFaces,
  serializeDetection,
  type FaceDetection,
} from '../../src/services/face-detection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestImage(width: number, height: number): sharp.Sharp {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).rotate();
}

function createOutputTensors(
  padW: number,
  padH: number,
  faces: Array<{
    stride: 8 | 16 | 32;
    row: number;
    col: number;
    clsScore: number;
    objScore: number;
    bboxOffsets: [number, number, number, number];
    kpsOffsets: number[];
  }>,
): Map<string, ort.Tensor> {
  const strides = [8, 16, 32] as const;
  const outputs = new Map<string, ort.Tensor>();

  for (const stride of strides) {
    const cols = Math.floor(padW / stride);
    const rows = Math.floor(padH / stride);
    const size = rows * cols;

    const cls = new Float32Array(size);
    const obj = new Float32Array(size);
    const bbox = new Float32Array(size * 4);
    const kps = new Float32Array(size * 10);

    for (const face of faces) {
      if (face.stride !== stride) continue;
      const idx = face.row * cols + face.col;
      cls[idx] = face.clsScore;
      obj[idx] = face.objScore;
      for (let i = 0; i < 4; i++) bbox[idx * 4 + i] = face.bboxOffsets[i];
      for (let i = 0; i < 10; i++) kps[idx * 10 + i] = face.kpsOffsets[i];
    }

    outputs.set(`cls_${stride}`, new ort.Tensor('float32', cls, [1, 1, rows, cols]));
    outputs.set(`obj_${stride}`, new ort.Tensor('float32', obj, [1, 1, rows, cols]));
    outputs.set(`bbox_${stride}`, new ort.Tensor('float32', bbox, [1, 4, rows, cols]));
    outputs.set(`kps_${stride}`, new ort.Tensor('float32', kps, [1, 10, rows, cols]));
  }

  return outputs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('face-detection service', () => {
  // -------------------------------------------------------------------------
  // padToDivisor
  // -------------------------------------------------------------------------

  describe('padToDivisor', () => {
    it('returns the value when already a multiple of 32', () => {
      expect(padToDivisor(32)).toBe(32);
      expect(padToDivisor(64)).toBe(64);
      expect(padToDivisor(640)).toBe(640);
    });

    it('rounds up to next multiple of 32', () => {
      expect(padToDivisor(1)).toBe(32);
      expect(padToDivisor(33)).toBe(64);
      expect(padToDivisor(100)).toBe(128);
      expect(padToDivisor(320)).toBe(320);
    });

    it('handles edge case of 31', () => {
      expect(padToDivisor(31)).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // computeDetectionSize
  // -------------------------------------------------------------------------

  describe('computeDetectionSize', () => {
    it('does not resize images ≤600px wide', () => {
      const result = computeDetectionSize(600, 400);
      expect(result).toEqual({ width: 600, height: 400, scale: 1 });
    });

    it('does not resize small images', () => {
      const result = computeDetectionSize(320, 240);
      expect(result).toEqual({ width: 320, height: 240, scale: 1 });
    });

    it('scales down images wider than 600px', () => {
      const result = computeDetectionSize(1200, 800);
      expect(result.width).toBe(600);
      expect(result.height).toBe(400);
      expect(result.scale).toBe(0.5);
    });

    it('preserves aspect ratio when scaling', () => {
      const result = computeDetectionSize(1800, 1200);
      expect(result.width).toBe(600);
      expect(result.height).toBe(400);
      expect(result.scale).toBeCloseTo(1 / 3);
    });

    it('handles portrait orientation', () => {
      const result = computeDetectionSize(900, 1600);
      expect(result.width).toBe(600);
      expect(result.scale).toBeCloseTo(2 / 3);
      expect(result.height).toBe(Math.round(1600 * (2 / 3)));
    });
  });

  // -------------------------------------------------------------------------
  // preprocessImage
  // -------------------------------------------------------------------------

  describe('preprocessImage', () => {
    it('produces a tensor with correct NCHW shape', async () => {
      const image = createTestImage(320, 240);
      const { tensor, padW, padH } = await preprocessImage(image, 320, 240);

      expect(padW).toBe(320);
      expect(padH).toBe(256);
      expect(tensor.dims).toEqual([1, 3, 256, 320]);
    });

    it('pads dimensions to multiples of 32', async () => {
      const image = createTestImage(300, 200);
      const { tensor, padW, padH } = await preprocessImage(image, 300, 200);

      expect(padW).toBe(320);
      expect(padH).toBe(224);
      expect(tensor.dims).toEqual([1, 3, 224, 320]);
    });

    it('returns float32 data', async () => {
      const image = createTestImage(64, 64);
      const { tensor } = await preprocessImage(image, 64, 64);

      expect(tensor.type).toBe('float32');
    });
  });

  // -------------------------------------------------------------------------
  // decodeDetections
  // -------------------------------------------------------------------------

  describe('decodeDetections', () => {
    it('returns empty array when no scores exceed threshold', () => {
      const outputs = createOutputTensors(320, 256, []);
      const detections = decodeDetections(outputs, 320, 256, 0.6);
      expect(detections).toEqual([]);
    });

    it('decodes a single face at stride 8', () => {
      const outputs = createOutputTensors(320, 256, [{
        stride: 8,
        row: 10,
        col: 20,
        clsScore: 0.9,
        objScore: 0.9,
        bboxOffsets: [0.5, 0.5, Math.log(12), Math.log(15)],
        kpsOffsets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      }]);

      const detections = decodeDetections(outputs, 320, 256, 0.6);
      expect(detections).toHaveLength(1);

      const d = detections[0];
      expect(d.score).toBeCloseTo(0.9);

      const cx = (20 + 0.5) * 8;
      const cy = (10 + 0.5) * 8;
      const w = 12 * 8;
      const h = 15 * 8;
      expect(d.x).toBeCloseTo(cx - w / 2);
      expect(d.y).toBeCloseTo(cy - h / 2);
      expect(d.width).toBeCloseTo(w);
      expect(d.height).toBeCloseTo(h);
    });

    it('filters detections below score threshold', () => {
      const outputs = createOutputTensors(320, 256, [{
        stride: 8,
        row: 5,
        col: 5,
        clsScore: 0.3,
        objScore: 0.3,
        bboxOffsets: [0, 0, 0, 0],
        kpsOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }]);

      const detections = decodeDetections(outputs, 320, 256, 0.6);
      expect(detections).toHaveLength(0);
    });

    it('decodes landmarks relative to anchor position', () => {
      const outputs = createOutputTensors(320, 256, [{
        stride: 16,
        row: 5,
        col: 10,
        clsScore: 0.95,
        objScore: 0.95,
        bboxOffsets: [0, 0, 0, 0],
        kpsOffsets: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
      }]);

      const detections = decodeDetections(outputs, 320, 256, 0.6);
      expect(detections).toHaveLength(1);

      const lm = detections[0].landmarks;
      expect(lm[0]).toBeCloseTo((1.0 + 10) * 16);
      expect(lm[1]).toBeCloseTo((2.0 + 5) * 16);
      expect(lm[2]).toBeCloseTo((3.0 + 10) * 16);
      expect(lm[3]).toBeCloseTo((4.0 + 5) * 16);
    });

    it('clamps cls and obj scores to [0, 1]', () => {
      const outputs = createOutputTensors(320, 256, [{
        stride: 8,
        row: 0,
        col: 0,
        clsScore: 1.5,
        objScore: 1.2,
        bboxOffsets: [0, 0, 0, 0],
        kpsOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }]);

      const detections = decodeDetections(outputs, 320, 256, 0.5);
      expect(detections).toHaveLength(1);
      expect(detections[0].score).toBe(1.0);
    });

    it('handles negative scores by clamping to 0', () => {
      const outputs = createOutputTensors(320, 256, [{
        stride: 8,
        row: 0,
        col: 0,
        clsScore: -0.5,
        objScore: 0.9,
        bboxOffsets: [0, 0, 0, 0],
        kpsOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }]);

      // Negative cls clamped to 0 → score = sqrt(0 * 0.9) = 0, filtered at threshold 0.1
      const detections = decodeDetections(outputs, 320, 256, 0.1);
      const atOrigin = detections.filter((d) => d.x <= 0 && d.y <= 0);
      expect(atOrigin).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // computeIoU
  // -------------------------------------------------------------------------

  describe('computeIoU', () => {
    it('returns 1 for identical boxes', () => {
      const box = { x: 10, y: 10, width: 50, height: 50 };
      expect(computeIoU(box, box)).toBe(1);
    });

    it('returns 0 for non-overlapping boxes', () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 20, y: 20, width: 10, height: 10 };
      expect(computeIoU(a, b)).toBe(0);
    });

    it('computes correct IoU for partially overlapping boxes', () => {
      const a = { x: 0, y: 0, width: 20, height: 20 };
      const b = { x: 10, y: 10, width: 20, height: 20 };
      // Intersection: 10x10 = 100, Union: 400 + 400 - 100 = 700
      expect(computeIoU(a, b)).toBeCloseTo(100 / 700);
    });

    it('is symmetric', () => {
      const a = { x: 0, y: 0, width: 30, height: 30 };
      const b = { x: 15, y: 15, width: 30, height: 30 };
      expect(computeIoU(a, b)).toBe(computeIoU(b, a));
    });

    it('handles contained box', () => {
      const outer = { x: 0, y: 0, width: 100, height: 100 };
      const inner = { x: 25, y: 25, width: 50, height: 50 };
      // Intersection: 50x50 = 2500, Union: 10000 + 2500 - 2500 = 10000
      expect(computeIoU(outer, inner)).toBeCloseTo(2500 / 10000);
    });

    it('returns 0 for zero-area boxes', () => {
      const a = { x: 0, y: 0, width: 0, height: 0 };
      const b = { x: 0, y: 0, width: 10, height: 10 };
      expect(computeIoU(a, b)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // nms
  // -------------------------------------------------------------------------

  describe('nms', () => {
    const makeDet = (
      x: number, y: number, w: number, h: number, score: number,
    ) => ({
      x, y, width: w, height: h, score,
      landmarks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number, number, number, number],
    });

    it('keeps all detections when they do not overlap', () => {
      const dets = [
        makeDet(0, 0, 10, 10, 0.9),
        makeDet(100, 100, 10, 10, 0.8),
        makeDet(200, 200, 10, 10, 0.7),
      ];
      const result = nms(dets, 0.3, 100);
      expect(result).toHaveLength(3);
    });

    it('suppresses overlapping lower-score detections', () => {
      const dets = [
        makeDet(0, 0, 50, 50, 0.9),
        makeDet(5, 5, 50, 50, 0.7),
      ];
      const result = nms(dets, 0.3, 100);
      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.9);
    });

    it('respects topK limit', () => {
      const dets = Array.from({ length: 10 }, (_, i) =>
        makeDet(i * 100, 0, 10, 10, 0.9 - i * 0.01),
      );
      const result = nms(dets, 0.3, 3);
      expect(result).toHaveLength(3);
    });

    it('returns empty array for empty input', () => {
      expect(nms([], 0.3, 100)).toEqual([]);
    });

    it('sorts by score descending', () => {
      const dets = [
        makeDet(0, 0, 10, 10, 0.5),
        makeDet(100, 100, 10, 10, 0.9),
        makeDet(200, 200, 10, 10, 0.7),
      ];
      const result = nms(dets, 0.3, 100);
      expect(result[0].score).toBe(0.9);
      expect(result[1].score).toBe(0.7);
      expect(result[2].score).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // scaleDetections
  // -------------------------------------------------------------------------

  describe('scaleDetections', () => {
    it('scales coordinates by inverse of scale factor', () => {
      const raw = [{
        x: 50, y: 30, width: 100, height: 120, score: 0.9,
        landmarks: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as [number, number, number, number, number, number, number, number, number, number],
      }];

      const scaled = scaleDetections(raw, 0.5);
      expect(scaled).toHaveLength(1);

      const d = scaled[0];
      expect(d.x).toBe(100);
      expect(d.y).toBe(60);
      expect(d.width).toBe(200);
      expect(d.height).toBe(240);
      expect(d.score).toBe(0.9);
      expect(d.landmarks.rightEye.x).toBe(20);
      expect(d.landmarks.rightEye.y).toBe(40);
      expect(d.landmarks.leftEye.x).toBe(60);
      expect(d.landmarks.leftEye.y).toBe(80);
    });

    it('does not scale when scale is 1', () => {
      const raw = [{
        x: 50, y: 30, width: 100, height: 120, score: 0.9,
        landmarks: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as [number, number, number, number, number, number, number, number, number, number],
      }];

      const scaled = scaleDetections(raw, 1);
      expect(scaled[0].x).toBe(50);
      expect(scaled[0].y).toBe(30);
      expect(scaled[0].landmarks.noseTip.x).toBe(50);
    });

    it('maps all 5 landmarks correctly', () => {
      const raw = [{
        x: 0, y: 0, width: 10, height: 10, score: 0.9,
        landmarks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as [number, number, number, number, number, number, number, number, number, number],
      }];

      const scaled = scaleDetections(raw, 0.5);
      const lm = scaled[0].landmarks;
      expect(lm.rightEye).toEqual({ x: 2, y: 4 });
      expect(lm.leftEye).toEqual({ x: 6, y: 8 });
      expect(lm.noseTip).toEqual({ x: 10, y: 12 });
      expect(lm.rightMouthCorner).toEqual({ x: 14, y: 16 });
      expect(lm.leftMouthCorner).toEqual({ x: 18, y: 20 });
    });
  });

  // -------------------------------------------------------------------------
  // generateFaceThumbnail
  // -------------------------------------------------------------------------

  describe('generateFaceThumbnail', () => {
    it('produces a non-empty JPEG buffer', async () => {
      const image = createTestImage(640, 480);
      const detection: FaceDetection = {
        x: 200, y: 150, width: 100, height: 120, score: 0.9,
        landmarks: {
          rightEye: { x: 220, y: 170 },
          leftEye: { x: 270, y: 170 },
          noseTip: { x: 245, y: 200 },
          rightMouthCorner: { x: 225, y: 230 },
          leftMouthCorner: { x: 265, y: 230 },
        },
      };

      const thumbnail = await generateFaceThumbnail(image, detection, 640, 480);
      expect(thumbnail.length).toBeGreaterThan(0);

      const meta = await sharp(thumbnail).metadata();
      expect(meta.format).toBe('jpeg');
    });

    it('clamps crop region to image bounds', async () => {
      const image = createTestImage(200, 200);
      const detection: FaceDetection = {
        x: 0, y: 0, width: 100, height: 100, score: 0.9,
        landmarks: {
          rightEye: { x: 20, y: 20 },
          leftEye: { x: 70, y: 20 },
          noseTip: { x: 45, y: 50 },
          rightMouthCorner: { x: 25, y: 75 },
          leftMouthCorner: { x: 65, y: 75 },
        },
      };

      const thumbnail = await generateFaceThumbnail(image, detection, 200, 200);
      expect(thumbnail.length).toBeGreaterThan(0);
    });

    it('limits thumbnail to 300px max dimension', async () => {
      const image = createTestImage(1920, 1080);
      const detection: FaceDetection = {
        x: 500, y: 200, width: 400, height: 500, score: 0.9,
        landmarks: {
          rightEye: { x: 600, y: 300 },
          leftEye: { x: 800, y: 300 },
          noseTip: { x: 700, y: 400 },
          rightMouthCorner: { x: 620, y: 500 },
          leftMouthCorner: { x: 780, y: 500 },
        },
      };

      const thumbnail = await generateFaceThumbnail(image, detection, 1920, 1080);
      const meta = await sharp(thumbnail).metadata();
      expect(meta.width!).toBeLessThanOrEqual(300);
      expect(meta.height!).toBeLessThanOrEqual(300);
    });
  });

  // -------------------------------------------------------------------------
  // detectFaces (integration with mocked session)
  // -------------------------------------------------------------------------

  describe('detectFaces', () => {
    let mockSession: ort.InferenceSession;

    beforeEach(() => {
      mockSession = {
        run: vi.fn(),
        inputNames: ['input'],
        outputNames: [...Array.from({ length: 12 }, (_, i) => {
          const types = ['cls', 'obj', 'bbox', 'kps'];
          const strides = [8, 16, 32];
          return `${types[Math.floor(i / 3)]}_${strides[i % 3]}`;
        })],
      } as unknown as ort.InferenceSession;
    });

    it('returns empty array when >20 faces detected (false positive filter)', async () => {
      const image = createTestImage(320, 240);
      const padW = padToDivisor(320);
      const padH = padToDivisor(240);

      const faces = Array.from({ length: 25 }, (_, i) => ({
        stride: 8 as const,
        row: i,
        col: 0,
        clsScore: 0.95,
        objScore: 0.95,
        bboxOffsets: [0, 0, 0, 0] as [number, number, number, number],
        kpsOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }));

      const outputs = createOutputTensors(padW, padH, faces);
      const outputObj: Record<string, ort.Tensor> = {};
      for (const [key, val] of outputs) outputObj[key] = val;

      vi.mocked(mockSession.run).mockResolvedValue(outputObj);

      const results = await detectFaces(mockSession, image);
      expect(results).toEqual([]);
    });

    it('returns detections with thumbnails for valid faces', async () => {
      const image = createTestImage(320, 240);
      const padW = padToDivisor(320);
      const padH = padToDivisor(240);

      const outputs = createOutputTensors(padW, padH, [{
        stride: 8,
        row: 15,
        col: 20,
        clsScore: 0.95,
        objScore: 0.95,
        bboxOffsets: [0, 0, Math.log(5), Math.log(6)],
        kpsOffsets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      }]);

      const outputObj: Record<string, ort.Tensor> = {};
      for (const [key, val] of outputs) outputObj[key] = val;

      vi.mocked(mockSession.run).mockResolvedValue(outputObj);

      const results = await detectFaces(mockSession, image);
      expect(results).toHaveLength(1);
      expect(results[0].detection.score).toBeGreaterThan(0.9);
      expect(results[0].thumbnail.length).toBeGreaterThan(0);
    });

    it('returns empty array when no faces detected', async () => {
      const image = createTestImage(320, 240);
      const padW = padToDivisor(320);
      const padH = padToDivisor(240);

      const outputs = createOutputTensors(padW, padH, []);
      const outputObj: Record<string, ort.Tensor> = {};
      for (const [key, val] of outputs) outputObj[key] = val;

      vi.mocked(mockSession.run).mockResolvedValue(outputObj);

      const results = await detectFaces(mockSession, image);
      expect(results).toEqual([]);
    });

    it('passes custom thresholds to the pipeline', async () => {
      const image = createTestImage(320, 240);
      const padW = padToDivisor(320);
      const padH = padToDivisor(240);

      const outputs = createOutputTensors(padW, padH, [{
        stride: 8,
        row: 10,
        col: 10,
        clsScore: 0.7,
        objScore: 0.7,
        bboxOffsets: [0, 0, Math.log(4), Math.log(5)],
        kpsOffsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }]);

      const outputObj: Record<string, ort.Tensor> = {};
      for (const [key, val] of outputs) outputObj[key] = val;

      vi.mocked(mockSession.run).mockResolvedValue(outputObj);

      // sqrt(0.7 * 0.7) = 0.7, which is above 0.5 but below 0.8
      const resultsLow = await detectFaces(mockSession, image, { scoreThreshold: 0.5 });
      expect(resultsLow).toHaveLength(1);

      const resultsHigh = await detectFaces(mockSession, image, { scoreThreshold: 0.8 });
      expect(resultsHigh).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // serializeDetection
  // -------------------------------------------------------------------------

  describe('serializeDetection', () => {
    it('serializes all detection fields', () => {
      const detection: FaceDetection = {
        x: 10, y: 20, width: 100, height: 120, score: 0.95,
        landmarks: {
          rightEye: { x: 30, y: 40 },
          leftEye: { x: 70, y: 40 },
          noseTip: { x: 50, y: 60 },
          rightMouthCorner: { x: 35, y: 80 },
          leftMouthCorner: { x: 65, y: 80 },
        },
      };

      const serialized = serializeDetection(detection);
      expect(serialized).toEqual({
        x: 10,
        y: 20,
        width: 100,
        height: 120,
        score: 0.95,
        landmarks: detection.landmarks,
      });
    });
  });
});
