# ONNX Model Setup

Face detection and recognition require two ONNX model files from the [OpenCV Zoo](https://github.com/opencv/opencv_zoo). These models are not bundled with the application and must be downloaded separately.

## Required Models

| Model | File | Purpose | Source |
|---|---|---|---|
| YuNet | `face_detection_yunet_2023mar.onnx` | Face detection (bounding boxes + 5 landmarks) | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| SFace | `face_recognition_sface_2021dec.onnx` | Face recognition (128-d embedding extraction) | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |

## Download

Create a `models/` directory in the project root (or any location you prefer) and download both files:

```bash
mkdir -p models
curl -L -o models/face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

curl -L -o models/face_recognition_sface_2021dec.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

## Configuration

Model paths are stored as database settings and can be configured via the Settings API once the server is running:

- `onnxFaceDetectionModel` — path to the YuNet detection model
- `onnxFaceRecognitionModel` — path to the SFace recognition model

Until the Settings API is implemented, model paths are passed directly to the `loadModels()` function.

## Model Details

### YuNet (Face Detection)

- **Input:** RGB image tensor `[1, 3, H, W]` (dynamic height/width, padded to multiples of 32)
- **Output:** 12 tensors across 3 feature map scales (stride 8, 16, 32):
  - `cls_8/16/32` — classification confidence scores
  - `obj_8/16/32` — objectness scores
  - `bbox_8/16/32` — bounding box regressions (center offsets + log width/height)
  - `kps_8/16/32` — 5 facial landmark coordinates (right eye, left eye, nose tip, right mouth corner, left mouth corner)
- **Post-processing:** Decode boxes from anchor grid, apply NMS, filter by confidence threshold
- **Detection range:** Faces from ~10x10 to ~300x300 pixels

### SFace (Face Recognition)

- **Input:** Aligned face image tensor `[1, 3, 112, 112]`, normalized (pixel / 255.0)
- **Output:** 128-dimensional feature embedding vector
- **Alignment:** Similarity transform using 5 facial landmarks to canonical positions:
  - Right eye: (38.29, 51.70)
  - Left eye: (73.53, 51.50)
  - Nose tip: (56.03, 71.74)
  - Right mouth: (41.55, 92.37)
  - Left mouth: (70.73, 92.20)
- **Comparison:** Cosine similarity between L2-normalized embeddings (threshold: 0.363)

## Licensing

- YuNet: [MIT License](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)
- SFace: [Apache 2.0 License](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE)
