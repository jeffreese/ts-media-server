# ONNX Model Setup

Face detection and recognition require two ONNX model files. These models are not bundled with the application and must be downloaded separately.

## Required Models

| Model | File | Purpose | Source |
|---|---|---|---|
| YuNet | `face_detection_yunet_2023mar.onnx` | Face detection (bounding boxes + 5 landmarks) | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| ArcFace (w600k_r50) | `w600k_r50.onnx` | Face recognition (512-d embedding extraction) | [InsightFace buffalo_l](https://github.com/deepinsight/insightface) |

## Download

Create a `models/` directory in the project root (or any location you prefer) and download both files:

```bash
mkdir -p models
curl -L -o models/face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

curl -L -o models/w600k_r50.onnx \
  https://huggingface.co/Aitrepreneur/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx
```

## Configuration

Model paths are stored as database settings and can be configured via the Settings API once the server is running:

- `onnxFaceDetectionModel` — path to the YuNet detection model
- `onnxFaceRecognitionModel` — path to the ArcFace recognition model

Until the Settings API is implemented, model paths are passed directly to the `loadModels()` function.

### Migrating from SFace

If you previously used the SFace model (`face_recognition_sface_2021dec.onnx`), download the new model, update the `faceRecognitionModelPath` setting to point to `w600k_r50.onnx`, then run **Admin > Maintenance > Re-extract Embeddings** to regenerate all face embeddings with the new model. This also clears and rebuilds face match data.

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

### ArcFace w600k_r50 (Face Recognition)

- **Input:** Aligned face image tensor `[1, 3, 112, 112]`, normalized `(pixel - 127.5) / 128.0`
- **Output:** 512-dimensional feature embedding vector
- **Training data:** WebFace600K (600K identities)
- **Alignment:** Similarity transform using 5 facial landmarks to canonical positions:
  - Right eye: (38.29, 51.70)
  - Left eye: (73.53, 51.50)
  - Nose tip: (56.03, 71.74)
  - Right mouth: (41.55, 92.37)
  - Left mouth: (70.73, 92.20)
- **Comparison:** Cosine similarity between L2-normalized embeddings (match threshold: 0.5)

## Licensing

- YuNet: [MIT License](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE)
- ArcFace (InsightFace): [MIT License](https://github.com/deepinsight/insightface/blob/master/LICENSE)
