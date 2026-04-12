# JavaXT Media Server — Node/TypeScript Conversion Tech Spec

## Overview

This document specifies the technology choices and architecture for converting the JavaXT Media Server from Java to a Node.js/TypeScript application. The converted application will maintain feature parity with the Java version (with noted exceptions) while adopting idiomatic Node.js patterns and a modern TypeScript toolchain.

## Source Reference

- **Original codebase:** JavaXT Media Server (Java 17, Maven)
- **Feature list:** `docs/feature-list.md`
- **ADRs for all decisions:** `conversion/adr/`

---

## Technology Stack

| Concern | Choice | Replaces (Java) |
|---|---|---|
| Language | TypeScript (pure ESM) | Java 17 |
| Runtime | Node.js | JVM |
| Database | SQLite + SpatiaLite | PostgreSQL + PostGIS / H2 |
| ORM | Drizzle ORM | javaxt.sql.Model (custom) |
| Web framework | Fastify | javaxt.http.Server |
| WebSocket | @fastify/websocket | javaxt.http.websocket |
| Image processing | sharp | Java AWT + ImageMagick + Openize |
| EXIF/metadata | exifr | Java EXIF API + ImageMagick EXIF |
| Face detection/recognition | onnxruntime-node | OpenCV (FaceDetectorYN + FaceRecognizerSF) |
| Perceptual hashing | Custom (sharp + DCT) | javaxt.io.Image.getPHash() |
| Video processing | FFmpeg via child_process | FFmpeg via javaxt.io.Shell |
| CLI framework | Commander.js | Custom arg parser |
| Auth | JWT + BCrypt | HTTP Basic Auth + BCrypt |
| Concurrency | p-limit | Java ThreadPool |
| Testing | Vitest | (none) |
| Logging | pino (via Fastify) | javaxt.express.utils.Logger |
| Config validation | Zod | (manual) |
| Package manager | pnpm | Maven |
| Build (dev) | tsx | (N/A — Java compiles) |
| Build (prod) | tsup | Maven JAR |

## External Dependencies (System-Level)

| Dependency | Required | Purpose |
|---|---|---|
| FFmpeg + ffprobe | Yes | Video frame extraction, transcoding, metadata |
| SpatiaLite | Yes | Geospatial geometry types and spatial indexing |
| ONNX model files | Yes (for face features) | YuNet (detection) + SFace (recognition) or equivalent |

**Eliminated from Java version:**
- ImageMagick — replaced by sharp (handles HEIC, TIFF, WebP, format conversion natively)
- OpenCV native libraries — replaced by onnxruntime-node
- Openize (HEIC fallback) — sharp handles HEIC via libvips/libheif

---

## Project Structure

Single package, pure ESM.

```
media-server/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── drizzle.config.ts
├── config.json                  # Default config (user-editable)
├── models/
│   └── schema.sql               # Reference SQL schema (informational)
├── drizzle/
│   └── migrations/              # Drizzle migration files
├── src/
│   ├── index.ts                 # Entry point (CLI dispatch)
│   ├── config/
│   │   ├── schema.ts            # Zod config schema
│   │   └── config.ts            # Config loader (file + env vars)
│   ├── db/
│   │   ├── client.ts            # SQLite/Drizzle client setup
│   │   ├── schema.ts            # Drizzle table definitions
│   │   └── migrate.ts           # Migration runner
│   ├── server/
│   │   ├── app.ts               # Fastify app factory
│   │   ├── auth.ts              # JWT auth plugin
│   │   ├── websocket.ts         # WebSocket event broadcasting
│   │   └── routes/
│   │       ├── image.ts         # GET /image
│   │       ├── video.ts         # GET /video
│   │       ├── face.ts          # GET /face, GET /matchingFaces
│   │       ├── index.ts         # GET /index (folder browsing)
│   │       ├── media-item.ts    # MediaItem CRUD
│   │       ├── thumbnails.ts    # GET /thumbnails
│   │       ├── settings.ts      # GET/POST /setting
│   │       ├── dir.ts           # File browser (admin)
│   │       └── models/          # Auto-generated CRUD routes per model
│   ├── services/
│   │   ├── file-index.ts        # Directory scanning and indexing
│   │   ├── thumbnail.ts         # Thumbnail generation
│   │   ├── face-detection.ts    # ONNX face detection
│   │   ├── face-recognition.ts  # ONNX face recognition/matching
│   │   ├── phash.ts             # Perceptual hashing
│   │   ├── metadata.ts          # EXIF/IPTC/GPS extraction
│   │   ├── notification.ts      # Event bus (NotificationService)
│   │   └── security.ts          # Per-model security filtering
│   ├── utils/
│   │   ├── ffmpeg.ts            # FFmpeg/ffprobe wrapper
│   │   ├── image.ts             # sharp helper functions
│   │   └── file.ts              # File system utilities
│   └── cli/
│       ├── serve.ts             # Start web server
│       ├── add.ts               # Index directory
│       ├── delete.ts            # Delete thumbnails/orphans
│       └── test.ts              # Test commands
├── test/
│   ├── services/
│   ├── routes/
│   └── utils/
└── web/                         # Static web app files
```

---

## Database Schema

### Approach

The Drizzle schema will mirror the Java version's `models/schema.sql` with these adaptations:

- **Geometry columns** → SpatiaLite geometry type via raw SQL column definitions in Drizzle
- **JSONB columns** → SQLite `text` columns storing JSON strings (Drizzle supports JSON mode for text columns)
- **BIGSERIAL** → SQLite `integer` primary keys with autoincrement
- **TIMESTAMP WITH TIME ZONE** → SQLite `text` columns storing ISO 8601 strings (or integer Unix timestamps)
- **bytea** → SQLite `blob`

### Tables (33 tables, matching Java version)

Core media tables:
- `media_item`, `file`, `path`, `host`, `folder`, `folder_entry`
- `media_item_file` (junction), `media_item_keyword` (junction)
- `keyword`, `media_match`, `media_access`, `media_log`

Feature/face tables:
- `feature`, `feature_match`, `person_feature`

People/places:
- `person`, `person_name`, `person_address`, `person_contact`
- `place`, `place_name`, `place_media`, `address`

User management:
- `user`, `user_access`, `user_authentication`, `user_preference`
- `user_activity`, `user_rating`, `user_group`, `user_group_user` (junction)

System:
- `component`, `setting`, `datatype`, `data`, `data_access`

---

## Feature Mapping

### 1. Media Indexing & Cataloging

**Java approach:** Multi-threaded `FileIndex` class with `ThreadPool`, scans directories, groups files, creates `MediaItem` records.

**Node approach:** Async directory walker using `fs.readdir` with recursive option. Process files with `p-limit` concurrency limiter (default: CPU count). Same file-grouping logic (group by name, handle iPhone sidecars). Sharp replaces Java AWT + ImageMagick for image loading.

### 2. Thumbnail Generation

**Java approach:** Custom RRD binary format, 10 resolution tiers, stored in `.thumbnails` subdirectory.

**Node approach:** Individual JPEG files per resolution tier, 5 tiers (1920x1080, 1280x720, 640x480, 300x300, 150x100). Stored in `.thumbnails` subdirectory. Sharp handles resize, sharpen, and JPEG encoding. Atomic writes via temp file + rename.

### 3. Face Detection & Recognition

**Java approach:** OpenCV FaceDetectorYN (YuNet ONNX) for detection, FaceRecognizerSF (SFace) for recognition. Per-thread model instances. Async matching via thread pools.

**Node approach:** onnxruntime-node running ONNX models directly. Sharp for image preprocessing (resize, color conversion, buffer extraction). p-limit for concurrency control. Same two-phase matching strategy (recent cache, then batched DB scan). Same transitive matching algorithm for face lookups.

### 4. Perceptual Hashing

**Java approach:** `javaxt.io.Image.getPHash()` with Hamming distance.

**Node approach:** Custom implementation — sharp resizes to 32x32 grayscale, then DCT-based pHash computation in TypeScript (~50 lines). Hamming distance via XOR + popcount. Same two-phase matching strategy.

### 5. Video Processing

**Java approach:** Shells out to `ffmpeg` and `ffprobe` via `javaxt.io.Shell`.

**Node approach:** `child_process.execFile` with a thin `FFmpeg` utility class. Same commands: frame extraction at 4s mark, MP4 transcoding (stream copy for MOV, libx264 for others), metadata extraction via ffprobe JSON output.

### 6. Web Server

**Java approach:** javaxt.http.Server with custom servlet, static file serving, WebSocket.

**Node approach:** Fastify with `@fastify/static` for web directory serving, `@fastify/websocket` for real-time events. `@fastify/cors` for CORS. File watching via `fs.watch` with debounce.

### 7. REST API

**Java approach:** javaxt-express WebService with auto-registered model CRUD, custom endpoints for media serving.

**Node approach:** Fastify routes. Generic CRUD route generator that registers get/list/save/delete for each Drizzle table. Custom route handlers for `/image`, `/video`, `/face`, `/matchingFaces`, `/thumbnails`, `/index`, `/setting`, `/dir`.

### 8. Authentication & Authorization

**Java approach:** HTTP Basic Auth, BCrypt, custom Authenticator, SecurityFilter.

**Node approach:** JWT via `@fastify/jwt`. Login endpoint issues tokens. BCrypt for password storage (`bcrypt` npm package). Fastify `onRequest` hook for auth. Security filter as Fastify preHandler that modifies queries per model type. Disabled auth mode checks `auth_status` setting.

### 9. WebSocket Notifications

**Java approach:** `NotificationService` singleton with listeners, broadcasts to `WebSocketListener` instances.

**Node approach:** EventEmitter-based `NotificationService`. Fastify WebSocket connections stored in a `Map`. Events broadcast to all connected clients. Same message format: `action,model,id,userId`.

### 10. CLI

**Java approach:** Custom arg parser in `Main.java`, branches to functions.

**Node approach:** Commander.js with subcommands:
- `media-server serve` — start web server (options: `--port`, `--config`, `--web`)
- `media-server add directory --path /path` — index a directory (options: `--concurrency`)
- `media-server delete thumbnails --path /path` — delete thumbnails
- `media-server delete orphans` — clean orphaned DB records
- `media-server test ffmpeg` — verify FFmpeg
- `media-server test metadata --file /path` — extract metadata
- `media-server test faces --file /path` — detect faces

### 11. Configuration

**Java approach:** `config.json` with relative path resolution, settings persisted to database.

**Node approach:** `config.json` for complex/nested settings + environment variable overrides for deployment settings. Zod schema validates the merged config at startup. Database-persisted settings for runtime-configurable values (FFmpeg path, ONNX model paths, auth status).

Config precedence: env vars > config.json > defaults.

### 12. Geospatial

**Java approach:** PostGIS geometry types, WKT parsing via JTS, GiST spatial indexes.

**Node approach:** SpatiaLite extension loaded into SQLite. Geometry columns defined via raw SQL in Drizzle migrations. WKT parsing via SpatiaLite functions (`GeomFromText`, `AsText`). Spatial indexes via SpatiaLite R-tree.

---

## Dropped Features

| Feature | Reason |
|---|---|
| Remote host proxy | Niche deployment pattern, adds significant complexity |
| SQL query endpoint (`/sql`) | Security surface, not needed for core functionality |
| Email service | Deferred to future phase |
| ImageMagick dependency | sharp covers all format conversion and metadata needs |
| Openize HEIC fallback | sharp handles HEIC natively via libheif |
| H2 database support | Single database (SQLite) simplifies the stack |
| Custom RRD thumbnail format | Individual JPEG files are simpler and more compatible |

---

## Concurrency Model

Node.js is single-threaded but the CPU-intensive work in this application happens in native code:

- **sharp (libvips)** — maintains its own thread pool for image operations
- **onnxruntime-node** — runs inference in native C++ threads
- **SQLite** — I/O handled by the OS

The JavaScript main thread handles orchestration: reading config, constructing queries, routing HTTP requests. This is lightweight glue code.

**Strategy:** Use `p-limit` to control how many files are processed concurrently during indexing (default: number of CPU cores). This prevents memory exhaustion from loading too many images simultaneously while letting sharp and onnxruntime saturate CPU cores internally.

If profiling reveals JS-thread bottlenecks, `worker_threads` can be introduced later without restructuring.

### Write Concurrency (SQLite)

SQLite is single-writer. To prevent `SQLITE_BUSY` errors during concurrent indexing and web requests:

- Enable WAL (Write-Ahead Logging) mode for concurrent reads during writes
- Serialize database writes through a single async queue when needed
- Use `busy_timeout` pragma to retry on lock contention

---

## Security Considerations

- JWT tokens with configurable expiration
- BCrypt password hashing (cost factor 12)
- Disabled auth mode only for initial setup — prompt user to create admin account
- Admin-only endpoints protected via role check in preHandler hooks
- File browser (`/dir`) restricted to SysAdmin access level
- Settings API validates paths before saving (FFmpeg, ONNX model files)
- No raw SQL endpoint (dropped from Java version)

---

## Build & Distribution

### Development
```bash
pnpm install
pnpm dev          # tsx watch mode
```

### Production
```bash
pnpm build        # tsup compiles to dist/
node dist/index.js serve --port 8080
```

### Testing
```bash
pnpm test         # vitest
pnpm test:watch   # vitest --watch
```

---

## Migration Path

This is a greenfield rewrite, not a line-by-line port. The database schema will be new (SQLite vs PostgreSQL), so there is no data migration path from the Java version. Users would need to re-index their media directories.

The ONNX models for face detection/recognition may differ from the Java version's models, so face feature vectors are not expected to be compatible across versions.

---

## Dependencies Summary

### Runtime Dependencies
```
fastify
@fastify/static
@fastify/websocket
@fastify/cors
@fastify/jwt
drizzle-orm
better-sqlite3
sharp
exifr
onnxruntime-node
bcrypt
commander
p-limit
pino
zod
```

### Dev Dependencies
```
typescript
tsx
tsup
vitest
drizzle-kit
@types/better-sqlite3
@types/bcrypt
```

### System Dependencies
```
FFmpeg + ffprobe
SpatiaLite (mod_spatialite)
```
