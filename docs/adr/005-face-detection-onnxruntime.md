# ADR-005: onnxruntime-node for Face Detection & Recognition

## Status
Accepted

## Context
The Java version uses OpenCV's `FaceDetectorYN` (YuNet ONNX model) for face detection and `FaceRecognizerSF` (SFace) for facial recognition. These are accessed through OpenCV's Java bindings with native library extraction from the JAR.

Options considered:
1. **opencv4nodejs-prebuilt** — Node bindings for OpenCV
2. **onnxruntime-node** — run ONNX models directly without OpenCV
3. **face-api.js / @vladmandic/face-api** — TensorFlow.js-based detection and recognition

## Decision
We will use **onnxruntime-node** to run ONNX detection and recognition models directly.

## Rationale
- **Cross-platform reliability** — opencv4nodejs bindings are notoriously fragile to install and maintain across platforms. onnxruntime-node has prebuilt binaries and is actively maintained by Microsoft.
- **Model flexibility** — we can run any ONNX model (YuNet, SFace, InsightFace, or newer models as they emerge) without being locked to OpenCV's API
- **Performance** — ONNX Runtime is optimized for inference performance, comparable to or faster than OpenCV's DNN module
- **Quality** — starting fresh with model selection is acceptable; we can evaluate the best available detection and recognition models rather than being constrained to YuNet/SFace
- **Simpler dependency** — one npm package vs. OpenCV native library extraction and platform-specific builds

## Tradeoffs
- **Pre/post-processing** — OpenCV's `FaceDetectorYN` and `FaceRecognizerSF` handle image preprocessing internally. With onnxruntime-node, we handle preprocessing (resize, normalize, color conversion) ourselves using sharp. This is more code but gives us full control.
- **Model compatibility** — face feature vectors from the new models will not be compatible with the Java version's database. This is acceptable since we're starting with a fresh database.
- **No OpenCV utilities** — we lose OpenCV's `Mat` operations, image drawing, etc. For our use case (detection + recognition + thumbnail cropping), sharp covers the image manipulation needs.
