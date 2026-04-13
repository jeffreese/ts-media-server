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
- **ONNX models** (optional) — for face detection and recognition

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the development server (with hot reload)
pnpm dev

# Or build and run
pnpm build
media-server serve
```

The server starts on port **8080** by default. Without a config file, it uses sensible defaults and an ephemeral JWT secret (tokens won't survive restarts).

## Configuration

Configuration is loaded from a JSON file (default: `config.json` in the working directory), with environment variable overrides.

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
pnpm dev          # Start with hot reload (tsx watch)
pnpm build        # Production build (tsup)
pnpm test         # Run tests once
pnpm test:watch   # Run tests in watch mode
pnpm typecheck    # Type-check without emitting
```

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
