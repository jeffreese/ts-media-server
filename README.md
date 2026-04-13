# ts-media-server

A self-hosted media server for photo and video libraries. Indexes directories of media files, extracts metadata, generates thumbnails at multiple resolutions, detects and matches faces using ONNX models, and serves everything through a REST API with real-time WebSocket notifications.

## Features

- **Directory indexing** — recursively scans directories, registers files, and mirrors the folder hierarchy in a virtual folder tree
- **Metadata extraction** — pulls EXIF, IPTC, GPS, and video metadata from images and videos (via [exifr](https://github.com/nickaknudson/exifr) and FFmpeg)
- **Thumbnail generation** — creates JPEG thumbnails at configurable sizes (default: 1920×1080 down to 150×100) using [sharp](https://sharp.pixelplumbing.com/)
- **Face detection & recognition** — ONNX Runtime models detect faces in images, extract embeddings, and match faces across photos
- **Perceptual hashing** — computes pHash values and finds near-duplicate media items
- **Image & video serving** — streams originals and thumbnails with range request support; auto-converts non-MP4 video to MP4
- **Virtual folder browsing** — navigate the indexed library through a folder hierarchy API with pagination and recursive listing
- **People & places** — associate detected faces with people, track names, addresses, and geotagged locations
- **User management** — users, groups, role-based access control, preferences, ratings, and activity tracking
- **JWT authentication** — bcrypt password hashing, token-based auth with configurable expiration (or bypass for local use)
- **Generic CRUD** — auto-generated REST endpoints for all 27+ database models
- **Real-time updates** — WebSocket endpoint pushes create/update/delete notifications to connected clients
- **Orphan cleanup** — detects and removes database records for files that no longer exist on disk

## Prerequisites

- **Node.js** >= 22
- **pnpm** (v10+)
- **FFmpeg** / **FFprobe** — required for video metadata extraction, frame capture, and MP4 conversion
- **SpatiaLite** (`mod_spatialite`) — required for geospatial features (GPS coordinate storage, spatial indexing). Install via `brew install libspatialite` (macOS) or `apt install libsqlite3-mod-spatialite` (Debian/Ubuntu). The extension is auto-detected from common install paths; set `spatialitePath` in the database client options to override.
- **ONNX models** (optional) — for face detection and recognition (see [ONNX Model Setup](#onnx-model-setup) below)

## Quick Start

### 1. Install and build

```bash
pnpm install
pnpm build

# First time only — make the `media-server` command available globally
pnpm setup
source ~/.zshrc          # or restart your terminal
pnpm link --global
```

### 2. Start the server

```bash
media-server serve
```

The server starts on port **8080** by default. Auth is disabled initially, so no token is needed for API calls.

### 3. (Optional) Set up face detection

In a separate terminal, download the ONNX models and configure their paths:

```bash
mkdir -p models
curl -L -o models/face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o models/face_recognition_sface_2021dec.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx

# Register the model paths (must be absolute)
curl -X POST http://localhost:8080/setting/faceDetectionModelPath \
  -H "Content-Type: application/json" \
  -d "{\"value\": \"$(pwd)/models/face_detection_yunet_2023mar.onnx\"}"
curl -X POST http://localhost:8080/setting/faceRecognitionModelPath \
  -H "Content-Type: application/json" \
  -d "{\"value\": \"$(pwd)/models/face_recognition_sface_2021dec.onnx\"}"
```

Skip this step if you don't need face detection — the indexer will work without it.

### 4. Index a media directory

```bash
media-server add directory --path /path/to/your/photos
```

This scans the directory, extracts metadata, generates thumbnails, detects faces (if models are configured), and finds near-duplicate images. Progress is printed as it runs.

### 5. Browse your library

With the server running, browse the indexed media:

```bash
# List root folders
curl http://localhost:8080/index

# Get a thumbnail
curl http://localhost:8080/image/1?width=300 --output thumb.jpg
```

## Configuration

Configuration is loaded from a JSON file (default: `config.json` in the working directory), with environment variable overrides. If no config file exists, the server uses sensible defaults: port 8080, an in-memory JWT secret (tokens won't survive restarts), and a SQLite database at `data/database.sqlite`.

### Config file

```json
{
  "port": 8080,
  "webDir": "./web",
  "logDir": "./logs",
  "logLevel": "info",
  "temp": "./tmp",
  "concurrency": 4,
  "database": {
    "path": "data/database.sqlite"
  },
  "thumbnails": {
    "sizes": ["1920x1080", "1280x720", "640x480", "300x300", "150x100"]
  },
  "jwt": {
    "secret": "your-secret-here",
    "expiresIn": "24h"
  }
}
```

### Environment variables

| Variable | Config key | Example |
|---|---|---|
| `PORT` | `port` | `3000` |
| `WEB_DIR` | `webDir` | `./public` |
| `LOG_DIR` | `logDir` | `./logs` |
| `LOG_LEVEL` | `logLevel` | `debug` |
| `TEMP_DIR` | `temp` | `/tmp/media-server` |
| `DATABASE_PATH` | `database.path` | `data/media.sqlite` |
| `CONCURRENCY` | `concurrency` | `8` |
| `JWT_SECRET` | `jwt.secret` | `my-secret` |
| `JWT_EXPIRES_IN` | `jwt.expiresIn` | `48h` |

Relative paths in the config file resolve relative to the config file's directory, not the process working directory.

## CLI

```
media-server <command>

Commands:
  serve                     Start the media server
    -p, --port <number>     Port to listen on
    -c, --config <path>     Path to config file
    -w, --web <path>        Path to web directory

  add directory             Index a directory of media files
    --path <path>           Directory to index
    --concurrency <number>  Parallel file processing limit

  delete thumbnails         Delete generated thumbnails for a directory
    --path <path>           Directory to delete thumbnails from
  delete orphans            Delete orphaned database records

  test ffmpeg               Verify FFmpeg installation
  test metadata --file <p>  Extract and display metadata from a file
  test faces --file <path>  Detect faces in an image
```

## API

All routes (except auth) require authentication when `auth_status` is enabled. Pass a JWT token via the `Authorization: Bearer <token>` header.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Authenticate with username/password, returns JWT |
| `POST` | `/auth/refresh` | Refresh an expiring token |

### Browsing

| Method | Path | Description |
|---|---|---|
| `GET` | `/index` | List root-level folders and items |
| `GET` | `/index/*` | Browse a folder path (e.g. `/index/Photos/2024`) |

Query: `?recursive=true&offset=0&limit=50`

### Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/image/:id` | Serve an image (optional `?width=&height=` for thumbnails) |
| `GET` | `/image` | Serve image by path (`?dir=&file=`) |
| `GET` | `/video/:id` | Stream a video (supports range requests) |
| `GET` | `/face/:id` | Get a face detection thumbnail |
| `GET` | `/thumbnail/:id` | Get a media item thumbnail |
| `GET` | `/media-item/:id` | Get media item details with files and metadata |

### Directory Management

| Method | Path | Description |
|---|---|---|
| `POST` | `/dir/index` | Trigger indexing for a directory |
| `POST` | `/dir/reindex` | Re-index an existing directory |
| `DELETE` | `/dir/thumbnails` | Delete thumbnails for a directory |
| `DELETE` | `/dir/orphans` | Clean up orphaned records |

### Generic CRUD

Every model in the database gets auto-generated endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/:model` | List records (paginated) |
| `GET` | `/:model/:id` | Get a single record |
| `POST` | `/:model` | Create a record |
| `PUT` | `/:model/:id` | Update a record |
| `DELETE` | `/:model/:id` | Delete a record |

### WebSocket

Connect to `/ws` for real-time notifications. Messages arrive as comma-delimited strings: `action,source,id,userId`.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript 6 (strict mode) |
| HTTP | [Fastify](https://fastify.dev) |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Image processing | [sharp](https://sharp.pixelplumbing.com) |
| Video processing | FFmpeg (via child process) |
| Face detection | [ONNX Runtime](https://onnxruntime.ai) |
| Auth | JWT + bcrypt |
| Validation | [Zod](https://zod.dev) v4 |
| Logging | [Pino](https://getpino.io) |
| Build | [tsup](https://tsup.egoist.dev) |
| Test | [Vitest](https://vitest.dev) |

## Development

```bash
pnpm dev          # Start with hot reload (tsx watch) — no build/link needed
pnpm build        # Production build (tsup)
pnpm test         # Run tests once
pnpm test:watch   # Run tests in watch mode
pnpm typecheck    # Type-check without emitting
```

After `pnpm build`, re-run `pnpm link --global` to update the global `media-server` command with the latest build.

## ONNX Model Setup

Face detection and recognition require two ONNX model files from the [OpenCV Zoo](https://github.com/opencv/opencv_zoo). These are optional — the server and indexing pipeline work without them, but face features will be skipped.

See [Quick Start step 3](#3-optional-set-up-face-detection) for the short version. The details below cover what happens under the hood.

The model paths are stored in the database `setting` table and read by the CLI at indexing time. Paths **must be absolute** — relative paths are rejected. You can update them at any time; the new paths take effect on the next `add directory` run.

| Setting key | Model | File |
|---|---|---|
| `faceDetectionModelPath` | YuNet (face detection) | `face_detection_yunet_2023mar.onnx` |
| `faceRecognitionModelPath` | SFace (face recognition) | `face_recognition_sface_2021dec.onnx` |

When auth is enabled, the `POST /setting/:key` endpoint requires a valid JWT token with SysAdmin access. When auth is disabled (the default), no token is needed.

For more details on model inputs, outputs, and licensing, see [docs/onnx-models.md](docs/onnx-models.md).

## Project Structure

```
src/
├── cli/              CLI commands (serve, add, delete, test)
├── config/           Config schema and loader
├── db/               Database client, schema, migrations, seed
├── server/
│   ├── app.ts        Fastify app factory
│   ├── auth.ts       JWT authentication plugin
│   ├── websocket.ts  WebSocket notifications
│   └── routes/       Route plugins (index, image, video, face, CRUD, …)
├── services/         Core logic (file indexing, thumbnails, faces, hashing, …)
└── utils/            Shared utilities (image, ffmpeg, file, logger)
test/                 Mirrors src/ structure with *.test.ts files
```

## License

ISC
