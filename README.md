# ts-media-server

A self-hosted media server for photo and video libraries. Index your directories, browse them in a responsive web UI, and let the server handle metadata extraction, thumbnail generation, face detection, duplicate finding, and geotagged maps — all backed by SQLite and served through a REST API with real-time WebSocket updates.

## Features

### Web UI

- **Folder browsing** — navigate your library's folder hierarchy with infinite-scroll thumbnail grids
- **Lightbox** — full-screen image viewer with keyboard navigation and an info panel showing metadata
- **Video playback** — native HTML5 player with poster thumbnails and range-request streaming
- **Media detail** — EXIF/IPTC metadata, camera info, GPS coordinates, dimensions, detected faces, duplicate matches, keyword tags, and star ratings
- **People & face triage** — review detected face clusters, assign them to people, merge duplicates, and browse all photos of a person; keyboard-driven triage workflow with suggested matches
- **Places & map** — Leaflet map with clustered markers for GPS-tagged media; manage place names and addresses
- **Search** — filter by name, keyword, media type, and date range
- **Keywords** — tag cloud with per-keyword media views
- **Admin dashboard** — server stats, indexed paths, filesystem browser with upload/download, indexing controls with live progress, and maintenance tools (deduplication, orphan cleanup, face embedding backfill)
- **User management** — users, groups, preferences, per-user activity histograms
- **Dark/light theme** — toggle from the topbar, persisted per-browser
- **Real-time updates** — WebSocket-driven auto-refresh across all pages as media is indexed or changed

### Backend

- **Directory indexing** — recursively scans directories, registers files, and mirrors the folder hierarchy in a virtual folder tree
- **Metadata extraction** — EXIF, IPTC, GPS, and video metadata via [exifr](https://github.com/nickaknudson/exifr) and FFmpeg
- **Thumbnail generation** — multi-resolution JPEG thumbnails (default: 1920 down to 150px) via [sharp](https://sharp.pixelplumbing.com/)
- **Face detection & recognition** — YuNet and SFace ONNX models detect faces, extract embeddings, and match across photos
- **Perceptual hashing** — pHash-based near-duplicate detection
- **JWT authentication** — bcrypt password hashing, token-based auth with configurable expiration (or bypass for local use)
- **Generic CRUD** — auto-generated REST endpoints for all 31 database models
- **WebSocket notifications** — real-time create/update/delete events and indexing progress

## Prerequisites

- **Node.js** >= 22
- **pnpm** (v10+)
- **FFmpeg** / **FFprobe** — for video metadata, frame capture, and MP4 conversion
- **SpatiaLite** (`mod_spatialite`) — for geospatial features. Install via `brew install libspatialite` (macOS) or `apt install libsqlite3-mod-spatialite` (Debian/Ubuntu). Auto-detected from common paths; override with `spatialitePath` in config.
- **ONNX models** (optional) — for face detection and recognition (see [ONNX Model Setup](#onnx-model-setup))

## Quick Start

### 1. Install and build

```bash
pnpm install
pnpm build

# First time only — make the CLI available globally
pnpm setup
source ~/.zshrc          # or restart your terminal
pnpm link --global
```

### 2. Start the server

```bash
media-server serve
```

The server starts on port **8080** by default. Open **http://localhost:8080** to use the web UI. Auth is disabled initially, so everything is accessible out of the box.

### 3. Index a media directory

From the **Admin** page in the web UI, enter a directory path and click **Index**. You'll see a live progress bar as files are scanned, thumbnails generated, and faces detected.

Or use the CLI:

```bash
media-server add directory --path /path/to/your/photos
```

### 4. (Optional) Set up face detection

Download the ONNX models and register their paths:

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

You can also configure these from the **Admin > Settings** tab in the web UI.

Skip this step if you don't need face detection — indexing works without it.

## Configuration

Configuration is loaded from a JSON file (default: `config.json` in the working directory), with environment variable overrides. If no config file exists, the server uses sensible defaults: port 8080, an in-memory JWT secret, and a SQLite database at `data/database.sqlite`.

### Config file

```json
{
  "port": 8080,
  "webDir": "./web/dist",
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

Relative paths resolve relative to the config file's directory, not the process working directory.

## CLI

The `media-server` CLI provides commands for server management and offline tasks.

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
    --profile               Print per-phase timing breakdown

  delete thumbnails         Delete generated thumbnails for a directory
    --path <path>           Directory to delete thumbnails from
  delete orphans            Delete orphaned database records

  test ffmpeg               Verify FFmpeg installation
  test metadata --file <p>  Extract and display metadata from a file
  test faces --file <path>  Detect faces in an image (requires --model)
```

## API

All routes (except auth) require authentication when enabled. Pass a JWT token via the `Authorization: Bearer <token>` header.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Authenticate with username/password, returns JWT |
| `POST` | `/auth/refresh` | Refresh an expiring token |

### Browsing

| Method | Path | Description |
|---|---|---|
| `GET` | `/index`, `/index/*` | Browse the virtual folder hierarchy |

Query: `?recursive=true&offset=0&limit=50`

### Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/image/:id` | Serve an image (optional `?width=&height=` for thumbnails) |
| `GET` | `/video/:id` | Stream a video (supports range requests) |
| `GET` | `/face/:id` | Get a face detection crop |
| `GET` | `/thumbnail/:id` | Get a media item thumbnail |
| `GET` | `/media-item/:id` | Get media item details with files and metadata |
| `GET` | `/search` | Search by name, keyword, type, date range |
| `GET` | `/map/media` | GPS-tagged media items for map rendering |

### Directory Management

| Method | Path | Description |
|---|---|---|
| `POST` | `/dir/index` | Trigger indexing for a directory |
| `POST` | `/dir/reindex` | Re-index an existing directory |
| `DELETE` | `/dir/thumbnails` | Delete thumbnails for a directory |
| `DELETE` | `/dir/orphans` | Clean up orphaned records |

### Generic CRUD

Every database model gets auto-generated endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/:model` | List records (paginated) |
| `GET` | `/:model/:id` | Get a single record |
| `POST` | `/:model` | Create a record |
| `DELETE` | `/:model/:id` | Delete a record |

### WebSocket

Connect to `/ws` for real-time notifications. Messages are comma-delimited: `action,source,id,userId`.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript 6 (strict mode) |
| HTTP | [Fastify](https://fastify.dev) 5 |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [SpatiaLite](https://www.gaia-gis.it/fossil/libspatialite) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Image processing | [sharp](https://sharp.pixelplumbing.com) |
| Video processing | FFmpeg |
| Face detection | [ONNX Runtime](https://onnxruntime.ai) (YuNet + SFace) |
| Auth | JWT + bcrypt |
| Validation | [Zod](https://zod.dev) v4 |
| Logging | [Pino](https://getpino.io) |
| Build | [tsup](https://tsup.egoist.dev) (server), [Vite](https://vite.dev) 6 (frontend) |
| Test | [Vitest](https://vitest.dev) |
| Frontend | [React](https://react.dev) 19, [Tailwind CSS](https://tailwindcss.com) 4, [react-router-dom](https://reactrouter.com) 7, [Leaflet](https://leafletjs.com), [Lucide](https://lucide.dev) icons |
| Linting | [Biome](https://biomejs.dev) (frontend) |

## Development

```bash
pnpm dev            # Start server + web frontend with hot reload
pnpm dev:server     # Start API server only (tsx watch)
pnpm dev:web        # Start Vite dev server only (port 5173, proxies API to :8080)
pnpm build          # Build frontend then production server bundle
pnpm build:web      # Build frontend only (output: web/dist/)
pnpm test           # Run server tests
pnpm test:web       # Run frontend tests
pnpm test:watch     # Run server tests in watch mode
pnpm typecheck      # Type-check server code
```

The project is a pnpm workspace monorepo with the server at the root and the web frontend in `web/`. During development, `pnpm dev` starts both in parallel — the Vite dev server on port 5173 proxies API requests to the Fastify server on port 8080. For production, `pnpm build` compiles the SPA into `web/dist/`, and the server serves it when `webDir` is set.

After `pnpm build`, re-run `pnpm link --global` to update the global `media-server` command with the latest build.

## ONNX Model Setup

Face detection and recognition require two ONNX model files from the [OpenCV Zoo](https://github.com/opencv/opencv_zoo). These are optional — the server and indexing pipeline work without them, but face features will be skipped.

The model paths are stored in the database `setting` table. Paths **must be absolute**. You can update them at any time via the Admin Settings page or the REST API; changes take effect on the next indexing run.

| Setting key | Model | File |
|---|---|---|
| `faceDetectionModelPath` | YuNet (face detection) | `face_detection_yunet_2023mar.onnx` |
| `faceRecognitionModelPath` | SFace (face recognition) | `face_recognition_sface_2021dec.onnx` |

For model details, see [docs/onnx-models.md](docs/onnx-models.md).

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
│   └── routes/       Route plugins (index, image, video, face, search, CRUD, …)
├── services/         Core logic (file indexing, thumbnails, faces, hashing, maintenance)
└── utils/            Shared utilities (image, ffmpeg, file, logger)
test/                 Mirrors src/ structure with *.test.ts files
web/
├── src/
│   ├── components/   Sidebar, topbar, media grid, lightbox, search bar, detail panels
│   ├── hooks/        useFetch, useTheme, useAutoRefresh
│   ├── lib/          Typed API client
│   └── pages/        Route pages (browse, media-item, people, face-triage, places, map,
│                       search, keywords, admin, settings, login)
├── index.html        SPA entry point
└── vite.config.ts    Vite + Tailwind + API proxy
```

## License

ISC
