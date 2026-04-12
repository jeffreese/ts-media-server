# Implementation Roadmap

This roadmap breaks the JavaXT Media Server Node/TypeScript conversion into sequential phases. Each phase builds on the previous one. Tasks within a phase can generally be worked in order, though some are parallelizable.

**Reference documents:**
- `conversion/tech-spec.md` — Technology choices and architecture
- `conversion/adr/` — Architecture Decision Records
- `docs/feature-list.md` — Java version feature inventory

---

## Phase 1: Project Scaffolding & Foundation

Establish the project structure, toolchain, and core infrastructure that everything else depends on.

### Project Setup
- [x] Create new repository with `pnpm init`
- [x] Configure `tsconfig.json` (strict mode, ESM, path aliases)
- [x] Configure `tsup.config.ts` for production builds
- [x] Configure Vitest (`vitest.config.ts`)
- [x] Add `.gitignore`, `.nvmrc` (pin Node version), `.editorconfig`
- [x] Set up `package.json` scripts: `dev`, `build`, `test`, `test:watch`, `lint`
- [x] Install core dev dependencies: `typescript`, `tsx`, `tsup`, `vitest`, `@types/node`
- [x] Install `semgrep` for static security analysis (`brew install semgrep`)

### Configuration System
- [x] Install `zod`
- [x] Define Zod config schema (`src/config/schema.ts`) with all config options and defaults
- [x] Implement config loader (`src/config/config.ts`): read `config.json`, merge env var overrides, validate with Zod
- [x] Support `--config` CLI flag for custom config file path
- [x] Write tests for config loading, env var overrides, and validation error messages

### Logging
- [x] Install `pino`
- [x] Create logger factory (`src/utils/logger.ts`) that creates pino instances from config
- [x] Support configurable log level (via config and `LOG_LEVEL` env var)
- [x] Support file transport for log directory output (when `logDir` is configured)
- [x] Write tests for logger creation and level configuration

### CLI Framework
- [x] Install `commander`
- [x] Create entry point (`src/index.ts`) with Commander.js program definition
- [x] Register subcommands: `serve`, `add`, `delete`, `test`
- [x] Implement `serve` subcommand skeleton (options: `--port`, `--config`, `--web`)
- [x] Implement `add directory` subcommand skeleton (options: `--path`, `--concurrency`)
- [x] Implement `delete thumbnails` subcommand skeleton (options: `--path`)
- [x] Implement `delete orphans` subcommand skeleton
- [x] Implement `test ffmpeg` subcommand skeleton
- [x] Implement `test metadata` subcommand skeleton (options: `--file`)
- [x] Implement `test faces` subcommand skeleton (options: `--file`)
- [x] Verify CLI runs via `tsx src/index.ts --help`

---

## Phase 2: Database & Schema

Set up the database layer that all data operations depend on.

### SQLite + SpatiaLite Setup
- [x] Install `better-sqlite3`, `@types/better-sqlite3`
- [x] Create database client (`src/db/client.ts`): open SQLite database, enable WAL mode, set `busy_timeout` pragma
- [x] Implement SpatiaLite extension loading with auto-detection of common install paths
- [x] Initialize SpatiaLite metadata tables (`InitSpatialMetaData`)
- [x] Write tests for database creation, WAL mode, and SpatiaLite loading

### Drizzle ORM Setup
- [x] Install `drizzle-orm`, `drizzle-kit`
- [x] Configure `drizzle.config.ts`
- [x] Define Drizzle schema (`src/db/schema.ts`) for all 33 tables:

#### Core Media Tables
- [x] `host` table (id, name, description, metadata)
- [x] `path` table (id, dir, hostId) with unique index on (dir, hostId)
- [x] `file` table (id, name, extension, pathId, type, date, size, hash, metadata) with unique index on (pathId, name, extension)
- [x] `media_item` table (id, name, description, type, startDate, endDate, hash, location, info)
- [x] `media_item_file` junction table (mediaItemId, fileId, isPrimary)
- [x] `keyword` table (id, word) with unique constraint
- [x] `media_item_keyword` junction table (mediaItemId, keywordId)
- [x] `media_match` table (id, mediaItemId, matchingItemId, matchInfo, ignoreMatch)
- [x] `media_access` table (id, itemId, groupId, readOnly)
- [x] `media_log` table (id, itemId, userId, date, action)
- [x] `folder` table (id, name, description, parentId, info) with unique index on (name, parentId)
- [x] `folder_entry` table (id, folderId, itemId, index, info) with unique index on (folderId, itemId)

#### Feature/Face Tables
- [x] `feature` table (id, itemId, coordinates, thumbnail, label, info)
- [x] `feature_match` table (id, featureId, matchingFeatureId, matchInfo, ignoreMatch)

#### People/Places Tables
- [x] `person` table (id, gender, birthday, info)
- [x] `person_name` table (id, personId, name, preferred, info)
- [x] `person_address` table (id, addressId, personId, type, preferred, info)
- [x] `person_contact` table (id, personId, contact, type, info)
- [x] `person_feature` table (id, featureId, personId, info)
- [x] `place` table (id, location, info)
- [x] `place_name` table (id, placeId, name, preferred, info)
- [x] `place_media` table (id, mediaId, placeId, info)
- [x] `address` table (id, street, city, state, postalCode, searchTerm, placeId)

#### User Management Tables
- [x] `user` table (id, personId, status)
- [x] `user_access` table (id, userId, componentId, level, info)
- [x] `user_authentication` table (id, userId, service, key, value, info)
- [x] `user_preference` table (id, userId, key, value)
- [x] `user_activity` table (id, userId, hour, minute, count)
- [x] `user_rating` table (id, userId, itemId, date, rating, comment)
- [x] `user_group` table (id, name, description)
- [x] `user_group_user` junction table (userGroupId, userId, isAdmin)

#### System Tables
- [x] `component` table (id, key, label, description, info)
- [x] `setting` table (id, key, value)
- [x] `datatype` table (id, label)
- [x] `data` table (id, name, description, typeId, data, date, thumbnail)
- [x] `data_access` table (id, datasetId, groupId, readOnly)

### Migrations & Initialization
- [x] Generate initial Drizzle migration from schema
- [x] Add SpatiaLite geometry columns and spatial indexes via custom migration SQL
- [x] Implement migration runner (`src/db/migrate.ts`)
- [x] Implement schema initialization: create default user, default person, default components (SysAdmin, UserAdmin, Media, Contact), grant admin access
- [x] Seed `setting` table with initial values (db_date, auth_status=disabled)
- [x] Write tests for migration, schema initialization, and seed data

---

## Phase 3: Core Utilities

Build the low-level utility modules that the indexing and serving layers depend on.

### File System Utilities
- [x] Implement `src/utils/file.ts`:
  - [x] Async recursive directory walker with file filter support
  - [x] File grouping by name (group related files: HEIC + JPG, MOV + MP4, iPhone sidecars)
  - [x] Primary file identification logic (prioritize HEIC, then non-JPEG media, then JPEG)
  - [x] Hidden directory detection (skip `.` and `_` prefixed directories)
  - [x] MD5 hash computation for files
  - [x] SHA1 hash computation for file integrity verification
  - [x] Atomic file write (write to temp, rename)
  - [x] Cross-platform path normalization
- [x] Write tests for file grouping, primary file detection, hidden dir filtering, hash computation

### FFmpeg Wrapper
- [x] Implement `src/utils/ffmpeg.ts`:
  - [x] Constructor: validate ffmpeg/ffprobe paths by running `ffmpeg -version`
  - [x] `createJPEG(input, output)` — extract frame at 4-second mark
  - [x] `createMP4(input, output)` — transcode to MP4 (stream copy for MOV, libx264 for others)
  - [x] `getMetadata(file)` — parse ffprobe JSON output (date, width, height, duration, frameRate)
  - [x] `getDuration(file)` — extract duration in seconds
  - [x] `isMovie(file)` — check extension against supported video formats
  - [x] `getSupportedExtensions()` — return list of video extensions
- [x] Write tests for metadata parsing, extension detection (mock execFile for unit tests)

### Image Utilities (sharp)
- [ ] Install `sharp`
- [ ] Implement `src/utils/image.ts`:
  - [ ] Load image from file (JPEG, PNG, WebP, TIFF, HEIC)
  - [ ] Get image dimensions
  - [ ] Auto-rotate based on EXIF orientation
  - [ ] Resize with aspect ratio preservation
  - [ ] Sharpen (for small thumbnails)
  - [ ] Crop region (for face thumbnail extraction)
  - [ ] Convert to JPEG buffer with configurable quality
  - [ ] Convert to raw pixel buffer (for ONNX preprocessing)
- [ ] Write tests for image loading, resize, rotation, crop

### Metadata Extraction
- [ ] Install `exifr`
- [ ] Implement `src/services/metadata.ts`:
  - [ ] Extract EXIF metadata from image files via sharp + exifr
  - [ ] Parse date (DateTimeOriginal + OffsetTimeOriginal)
  - [ ] Parse camera info (make, model, lens make, lens model)
  - [ ] Parse exposure info (focal length, aperture, f-stop, shutter speed, exposure time, ISO)
  - [ ] Parse GPS coordinates (latitude, longitude, datum, azimuth)
  - [ ] Convert GPS coordinates to WKT POINT string
  - [ ] Parse IPTC tags
  - [ ] Extract video metadata via FFmpeg wrapper
  - [ ] Sidecar JPEG metadata fallback (check for same-name .JPG when primary has no EXIF)
- [ ] Write tests for EXIF parsing, GPS coordinate conversion, video metadata extraction

---

## Phase 4: Thumbnail Generation

### Thumbnail Service
- [ ] Implement `src/services/thumbnail.ts`:
  - [ ] Define 5 resolution tiers: 1920x1080, 1280x720, 640x480, 300x300, 150x100
  - [ ] `createThumbnails(image, primaryFile)` — generate all applicable tiers
  - [ ] Skip tiers larger than the source image
  - [ ] Apply sharpening for ≤300px thumbnails
  - [ ] Set JPEG quality: 100% for ≤300px, 90% for larger
  - [ ] Write to `.thumbnails` subdirectory with naming convention: `{name}_{width}.jpg`
  - [ ] Atomic writes via temp file + rename
  - [ ] `getThumbnailDirectory(file)` — return `.thumbnails` path for a given file
  - [ ] `getThumbnailPath(file, width)` — return path for a specific thumbnail size
  - [ ] `deleteThumbnails(directory)` — recursively delete all `.thumbnails` subdirectories
  - [ ] `listThumbnails(mediaId)` — list available thumbnail sizes for a media item
- [ ] Write tests for thumbnail generation, tier selection, naming, quality settings

---

## Phase 5: Perceptual Hashing & Duplicate Detection

### pHash Implementation
- [ ] Implement `src/services/phash.ts`:
  - [ ] `computeHash(image)` — resize to 32x32 grayscale, compute DCT, generate 64-bit hash
  - [ ] `hammingDistance(hash1, hash2)` — XOR + popcount
  - [ ] DCT implementation (2D discrete cosine transform on 32x32 matrix)
  - [ ] Extract top-left 8x8 low-frequency coefficients
  - [ ] Generate binary hash string from median comparison
- [ ] Write tests for hash computation (known images), Hamming distance calculation

### Hash Matching Service
- [ ] Implement hash matching in `src/services/file-index.ts` (or separate `src/services/hash-matcher.ts`):
  - [ ] `matchHash(mediaId, hash)` — compare against all existing hashes
  - [ ] Two-phase matching: in-memory cache for recent items, then batched DB scan
  - [ ] Hamming distance threshold (0 = exact match)
  - [ ] Deduplication: skip comparisons where targetId >= sourceId
  - [ ] Check for existing match records before inserting
  - [ ] Create `media_match` records with match info (hamming_distance, match_date)
- [ ] Write tests for matching logic, deduplication, batch scanning

---

## Phase 6: Face Detection & Recognition

### ONNX Runtime Setup
- [ ] Install `onnxruntime-node`
- [ ] Research and select ONNX models for face detection and recognition
- [ ] Document model download/setup instructions
- [ ] Implement model loading and session creation

### Face Detection Service
- [ ] Implement `src/services/face-detection.ts`:
  - [ ] Load face detection ONNX model (YuNet or equivalent)
  - [ ] Preprocess image with sharp: resize to model input dimensions, convert to RGB buffer, normalize
  - [ ] Run inference via onnxruntime-node
  - [ ] Post-process detections: extract bounding boxes, confidence scores, facial landmarks
  - [ ] Scale coordinates back to original image dimensions
  - [ ] Filter detections by confidence threshold
  - [ ] Filter out images with >20 detections (likely false positives)
  - [ ] Generate face thumbnail crops (300px max) via sharp
  - [ ] Serialize detection data as JSON for database storage
- [ ] Write tests for preprocessing, post-processing, coordinate scaling

### Face Recognition Service
- [ ] Implement `src/services/face-recognition.ts`:
  - [ ] Load face recognition ONNX model (SFace or equivalent)
  - [ ] Align and crop face from image using detection landmarks
  - [ ] Extract face feature embedding via inference
  - [ ] `compareFaces(embedding1, embedding2)` — compute cosine similarity
  - [ ] Configurable similarity threshold (default: 0.363)
- [ ] Write tests for embedding extraction, cosine similarity computation

### Face Matching Pipeline
- [ ] Implement face matching in `src/services/file-index.ts` (or separate `src/services/face-matcher.ts`):
  - [ ] `matchFace(featureId)` — compare against all existing face features
  - [ ] Two-phase matching: in-memory cache for recent features, then batched DB scan
  - [ ] Deduplication: skip comparisons where targetId >= sourceId
  - [ ] Check for existing match records before inserting
  - [ ] Create `feature_match` records with match info (similarity, match_date)
  - [ ] Support `ignore_match` flag for false positives
- [ ] Implement transitive face matching:
  - [ ] `getMatchingFaces(featureId)` — BFS traversal up to 10 levels deep
  - [ ] Return distinct media items for matched features
- [ ] Write tests for matching pipeline, transitive matching, deduplication

---

## Phase 7: Media Indexing Pipeline

This is the core indexing engine that ties together all the services from Phases 3–6.

### Notification Service
- [ ] Implement `src/services/notification.ts`:
  - [ ] EventEmitter-based notification bus
  - [ ] `notify(event, source, data)` — emit typed events
  - [ ] `addListener(callback)` — register event handlers
  - [ ] Event types: create, update, delete (for models), progress (for indexing)
- [ ] Write tests for event emission and listener registration

### File Index Service
- [ ] Install `p-limit`
- [ ] Implement `src/services/file-index.ts`:

#### Path & File Registration
  - [ ] `addPaths(directory, fileFilter)` — scan directory, create `path` records, return path IDs
  - [ ] `addFiles(pathIds, fileFilter)` — create `file` records for media files, group by name, return ordered file ID groups
  - [ ] Skip hidden directories and `_`-prefixed directories
  - [ ] Compute MD5 hash for each file

#### Media Item Creation
  - [ ] `createMediaItem(fileIds, folderId, folderIndex)` — create or update a media item from a file group
  - [ ] Identify primary file from group (HEIC > non-JPEG > JPEG, skip short MOV sidecars)
  - [ ] Extract image via sharp (handle images, videos, HEIC)
  - [ ] Extract metadata (EXIF/IPTC/GPS for images, ffprobe for videos)
  - [ ] Compute perceptual hash
  - [ ] Generate thumbnails (5 tiers)
  - [ ] Create MP4 for non-MP4 video files
  - [ ] Store media item record (name, type, hash, dates, location, metadata)
  - [ ] Create `media_item_file` junction records with primary flag
  - [ ] Run face detection and store `feature` records with thumbnail crops

#### Folder Management
  - [ ] `getOrCreateFolder(directory, parentFolder)` — mirror directory structure as virtual folders
  - [ ] Create root folder on initialization
  - [ ] Create `folder_entry` records linking media items to folders with sort index

#### Directory Indexing Orchestration
  - [ ] `addDirectory(directory, fileFilter, concurrency)` — main entry point
  - [ ] Delete orphans before indexing
  - [ ] Scan paths and files
  - [ ] Process file groups with p-limit concurrency control
  - [ ] Queue hash matching after media item creation
  - [ ] Queue face matching after feature extraction
  - [ ] Emit progress notifications during indexing
  - [ ] Wait for all matching operations to complete

#### Orphan Cleanup
  - [ ] `deleteOrphans()` — check all DB files against disk, remove missing
  - [ ] Delete media items left with no files
  - [ ] Delete orphaned thumbnails
  - [ ] Delete paths with no files
  - [ ] Delete empty folders (recursive)

### Integration Tests
- [ ] Test full indexing pipeline with sample image directory
- [ ] Test orphan cleanup with deleted files
- [ ] Test re-indexing (update existing media items)
- [ ] Test file grouping with mixed formats (HEIC + JPG, MOV + MP4)
- [ ] Test progress notification emission

---

## Phase 8: Web Server & Core API

### Fastify Server Setup
- [ ] Install `fastify`, `@fastify/static`, `@fastify/cors`, `@fastify/websocket`, `@fastify/jwt`, `@fastify/multipart`
- [ ] Implement Fastify app factory (`src/server/app.ts`):
  - [ ] Create Fastify instance with pino logger
  - [ ] Register CORS plugin
  - [ ] Register static file serving for web directory
  - [ ] Register WebSocket plugin
  - [ ] Register JWT plugin
  - [ ] Register multipart plugin (for file uploads)
  - [ ] Register all route plugins
  - [ ] File watching on web directory with debounced notifications

### Authentication
- [ ] Install `bcrypt`, `@types/bcrypt`
- [ ] Implement JWT auth plugin (`src/server/auth.ts`):
  - [ ] `POST /auth/login` — validate credentials, issue JWT
  - [ ] `POST /auth/refresh` — refresh expiring token
  - [ ] JWT verification `onRequest` hook for protected routes
  - [ ] Disabled auth mode: bypass auth when `auth_status` setting is "disabled"
  - [ ] Extract user from JWT and attach to request
  - [ ] BCrypt password hashing (cost factor 12) for credential storage
- [ ] Write tests for login, token verification, disabled auth mode

### WebSocket Event Broadcasting
- [ ] Implement WebSocket handler (`src/server/websocket.ts`):
  - [ ] Track connected clients in a Map
  - [ ] Subscribe to NotificationService events
  - [ ] Broadcast events to all connected clients
  - [ ] Message format: `action,model,id,userId`
  - [ ] Handle client connect/disconnect
- [ ] Write tests for event broadcasting, client management

### Settings API
- [ ] Implement settings routes (`src/server/routes/settings.ts`):
  - [ ] `GET /setting/:key` — retrieve setting value by key (plain text)
  - [ ] `POST /setting/:key` — create/update setting (admin only)
  - [ ] Validate FFmpeg path on save (attempt to run `ffmpeg -version`)
  - [ ] Validate ONNX model paths on save (check file exists and has .onnx extension)
  - [ ] Prevent setting deletion
- [ ] Write tests for get/save settings, validation, admin-only enforcement

---

## Phase 9: Security & User Management

### Security Filter
- [ ] Implement security filter (`src/services/security.ts`):
  - [ ] `getAccessLevel(user, component)` — query user_access for permission level
  - [ ] Per-model query modification:
    - [ ] User: check UserAdmin access for save/delete of other users, protect last admin
    - [ ] UserPreference: scope queries to requesting user
    - [ ] UserAuthentication: enforce BCrypt hashing on password save, check permissions
    - [ ] UserAccess: validate admin count constraints, check UserAdmin permission
    - [ ] Component: require SysAdmin for save/delete
    - [ ] Datatype: require SysAdmin for save/delete
    - [ ] DataAccess: filter by user permissions, enforce read-only
    - [ ] Setting: prevent deletion
  - [ ] `getAdminCount(excludeUserId, component)` — count remaining admins
- [ ] Write tests for each model's security rules, admin protection

### Generic Model CRUD Routes
- [ ] Implement CRUD route generator (`src/server/routes/models/`):
  - [ ] Auto-register GET (by id), LIST (with pagination), SAVE (create/update), DELETE for each Drizzle table
  - [ ] JSON request body parsing
  - [ ] Offset/limit pagination via query parameters
  - [ ] Apply security filter as preHandler hook per model
  - [ ] Emit create/update/delete notifications via NotificationService
- [ ] Write tests for CRUD operations, pagination, security enforcement

### User Management Routes
- [ ] User CRUD with Person record linkage
- [ ] User activity tracking:
  - [ ] Increment request counter per user per minute (in-memory)
  - [ ] Batch write to `user_activity` table on interval (every 2 minutes)
  - [ ] Join last access data on user list queries
- [ ] User preference upsert (create or update by key)
- [ ] User group management with many-to-many user membership
- [ ] Write tests for user creation, activity tracking, preference upsert

---

## Phase 10: Media Serving API

### Image Serving
- [ ] Implement image route (`src/server/routes/image.ts`):
  - [ ] `GET /image/:id` — serve image by media item ID
  - [ ] Support `width` and `height` query parameters for thumbnail selection
  - [ ] Find best-fit thumbnail from available sizes
  - [ ] Fall back to original file for sizes larger than largest thumbnail
  - [ ] Version-based caching: compare `v` and `db` query params, redirect with 301 if stale
  - [ ] Set appropriate Content-Type and Last-Modified headers
  - [ ] Support path-based media item lookup (resolve by directory + filename)
- [ ] Write tests for thumbnail selection, version redirect, path-based lookup

### Video Serving
- [ ] Implement video route (`src/server/routes/video.ts`):
  - [ ] `GET /video/:id` — serve MP4 file by media item ID
  - [ ] Version-based caching with 301 redirect
  - [ ] Stream file with appropriate Content-Type
- [ ] Write tests for video serving, version redirect

### Face Serving
- [ ] Implement face routes (`src/server/routes/face.ts`):
  - [ ] `GET /face/:id` — serve face thumbnail by feature ID
  - [ ] Version-based caching with 301 redirect
  - [ ] `GET /matchingFaces/:id` — find media items matching a face
  - [ ] Transitive matching (BFS up to 10 levels)
  - [ ] Pagination support (offset/limit)
- [ ] Write tests for face thumbnail serving, transitive matching results

### Folder Browsing
- [ ] Implement index route (`src/server/routes/index.ts`):
  - [ ] `GET /index/*` — browse folder hierarchy by path
  - [ ] Return folders and media items at the requested level
  - [ ] Support `recursive` query parameter for deep listing
  - [ ] Pagination support (offset/limit)
- [ ] Write tests for folder browsing, recursive listing, pagination

### Thumbnail Listing
- [ ] Implement thumbnails route (`src/server/routes/thumbnails.ts`):
  - [ ] `GET /thumbnails/:id` — list available thumbnail sizes for a media item
  - [ ] Version-based caching with 301 redirect
- [ ] Write tests for thumbnail listing

### Media Item Details
- [ ] Implement media item route (`src/server/routes/media-item.ts`):
  - [ ] `GET /mediaItem/:id` — retrieve media item details (exclude files from response)
- [ ] Write tests for media item retrieval

### File Browser (Admin)
- [ ] Implement dir routes (`src/server/routes/dir.ts`):
  - [ ] `GET /dir` — list files/directories on server filesystem (SysAdmin only)
  - [ ] `POST /dir/upload` — upload files to server (SysAdmin only)
  - [ ] `GET /dir/download` — download files from server (SysAdmin only)
  - [ ] Validate SysAdmin access level
- [ ] Write tests for file browsing, upload, download, admin enforcement

---

## Phase 11: CLI Implementation

Wire the CLI subcommands to the services built in previous phases.

### Serve Command
- [ ] Implement `src/cli/serve.ts`:
  - [ ] Initialize config, database, and migrations
  - [ ] Start Fastify server on configured port
  - [ ] Log startup message with URL

### Add Directory Command
- [ ] Implement `src/cli/add.ts`:
  - [ ] Initialize config, database, and services
  - [ ] Validate `--path` argument (directory exists)
  - [ ] Build file filter from supported extensions
  - [ ] Run `fileIndex.addDirectory()` with configured concurrency
  - [ ] Display progress bar/counter using NotificationService events
  - [ ] Print summary on completion (files indexed, faces detected, matches found)

### Delete Commands
- [ ] Implement `src/cli/delete.ts`:
  - [ ] `delete thumbnails --path` — call `thumbnail.deleteThumbnails(directory)`
  - [ ] `delete orphans` — call `fileIndex.deleteOrphans()`
  - [ ] Print summary of deleted items

### Test Commands
- [ ] Implement `src/cli/test.ts`:
  - [ ] `test ffmpeg` — validate FFmpeg installation, print version
  - [ ] `test metadata --file` — extract and pretty-print metadata from a file
  - [ ] `test faces --file` — detect faces, print count and bounding boxes, save annotated image

---

## Phase 12: Data Management & Remaining Models

### Keywords
- [ ] Implement keyword tagging for media items
- [ ] Keyword CRUD via generic model routes
- [ ] Many-to-many linking via `media_item_keyword` junction table
- [ ] Unique keyword enforcement

### Media Logging
- [ ] Implement media audit log
- [ ] Create `media_log` entries on media item create/update/delete
- [ ] Include user ID and timestamp

### User Ratings
- [ ] Implement rating routes
- [ ] Per-user, per-media-item ratings with upsert behavior
- [ ] Optional comment and timestamp

### People & Places
- [ ] Person CRUD with linked names, addresses, contacts
- [ ] Person-feature linking (assign faces to people)
- [ ] Place CRUD with SpatiaLite geometry
- [ ] Place-media linking
- [ ] Place name management with preferred flag
- [ ] Address CRUD linked to places

### Generic Data Store
- [ ] Datatype CRUD
- [ ] Data CRUD with typed records, JSON payload, binary thumbnails
- [ ] Data access control via groups with read-only enforcement

### Media Access Control
- [ ] Media access CRUD (link media items to user groups)
- [ ] Read-only enforcement per group

---

## Phase 13: File Operations

### Media Item File Management
- [ ] Implement `moveMediaItem(mediaItem, outputPath)`:
  - [ ] Copy all associated files to output directory
  - [ ] Verify integrity with SHA1 checksums
  - [ ] Delete originals only after all copies verified
  - [ ] Rollback (delete copies) on any failure
  - [ ] Update file records in database with new paths
  - [ ] Move thumbnails to new `.thumbnails` directory
- [ ] Implement `mergeDirectories(inputPaths, outputPath)`:
  - [ ] Combine media items from multiple directories
  - [ ] Rename files using date-based naming (`IMG_{timestamp}`)
  - [ ] Handle duplicate filenames with suffix (`(2)`, `(3)`, etc.)
  - [ ] Skip media items without dates
- [ ] Write tests for move, merge, integrity verification, rollback

---

## Phase 14: Polish & Production Readiness

### Error Handling
- [ ] Add global Fastify error handler with structured error responses
- [ ] Add request validation error formatting
- [ ] Ensure all async operations have proper error handling
- [ ] Add graceful shutdown handler (close database, stop indexing, close WebSocket connections)

### Performance
- [ ] Profile indexing pipeline with a large directory (1000+ files)
- [ ] Tune p-limit concurrency defaults based on profiling
- [ ] Tune sharp thread pool size if needed (`sharp.concurrency()`)
- [ ] Verify SQLite WAL mode and busy_timeout are effective under concurrent load
- [ ] Add database indexes review — ensure all query patterns are indexed

### Documentation
- [ ] Write README.md with:
  - [ ] Project description
  - [ ] System requirements (Node.js, FFmpeg, SpatiaLite)
  - [ ] Installation instructions
  - [ ] Configuration reference
  - [ ] CLI usage guide
  - [ ] API endpoint reference
- [ ] Add inline JSDoc for public APIs
- [ ] Document ONNX model setup (where to download, how to configure)

### Build & Distribution
- [ ] Verify `tsup` production build works end-to-end
- [ ] Test production build: `pnpm build && node dist/index.js serve`
- [ ] Verify CLI works from built output: `node dist/index.js add directory --path /test`
- [ ] Add `bin` entry to `package.json` for global install (`pnpm install -g`)
- [ ] Test cross-platform: macOS, Linux (Windows if applicable)

### Testing Coverage
- [ ] Review test coverage for all services
- [ ] Add edge case tests: empty directories, corrupt images, missing FFmpeg, missing SpatiaLite
- [ ] Add integration test: full index → serve → browse cycle
- [ ] Verify all security filter rules have test coverage

---

## Phase Summary

| Phase | Description | Key Deliverable |
|---|---|---|
| 1 | Project Scaffolding & Foundation | Runnable CLI skeleton with config and logging |
| 2 | Database & Schema | Full Drizzle schema with migrations and seed data |
| 3 | Core Utilities | File utils, FFmpeg wrapper, sharp helpers, metadata extraction |
| 4 | Thumbnail Generation | Multi-resolution JPEG thumbnail service |
| 5 | Perceptual Hashing | pHash computation and duplicate matching |
| 6 | Face Detection & Recognition | ONNX-based face detection, recognition, and matching |
| 7 | Media Indexing Pipeline | Full directory indexing with all services integrated |
| 8 | Web Server & Core API | Fastify server with auth, WebSocket, and settings |
| 9 | Security & User Management | RBAC, security filter, user CRUD, activity tracking |
| 10 | Media Serving API | Image/video/face serving, folder browsing, file browser |
| 11 | CLI Implementation | All CLI commands wired to services |
| 12 | Data Management | Keywords, ratings, people, places, generic data store |
| 13 | File Operations | Media item move, directory merge, integrity verification |
| 14 | Polish & Production Readiness | Error handling, performance, docs, cross-platform testing |
