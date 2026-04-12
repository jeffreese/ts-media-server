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
- [x] Install `sharp`
- [x] Implement `src/utils/image.ts`:
  - [x] Load image from file (JPEG, PNG, WebP, TIFF, HEIC)
  - [x] Get image dimensions
  - [x] Auto-rotate based on EXIF orientation
  - [x] Resize with aspect ratio preservation
  - [x] Sharpen (for small thumbnails)
  - [x] Crop region (for face thumbnail extraction)
  - [x] Convert to JPEG buffer with configurable quality
  - [x] Convert to raw pixel buffer (for ONNX preprocessing)
- [x] Write tests for image loading, resize, rotation, crop

### Metadata Extraction
- [x] Install `exifr`
- [x] Implement `src/services/metadata.ts`:
  - [x] Extract EXIF metadata from image files via sharp + exifr
  - [x] Parse date (DateTimeOriginal + OffsetTimeOriginal)
  - [x] Parse camera info (make, model, lens make, lens model)
  - [x] Parse exposure info (focal length, aperture, f-stop, shutter speed, exposure time, ISO)
  - [x] Parse GPS coordinates (latitude, longitude, datum, azimuth)
  - [x] Convert GPS coordinates to WKT POINT string
  - [x] Parse IPTC tags
  - [x] Extract video metadata via FFmpeg wrapper
  - [x] Sidecar JPEG metadata fallback (check for same-name .JPG when primary has no EXIF)
- [x] Write tests for EXIF parsing, GPS coordinate conversion, video metadata extraction

---

## Phase 4: Thumbnail Generation

### Thumbnail Service
- [x] Implement `src/services/thumbnail.ts`:
  - [x] Define 5 resolution tiers: 1920x1080, 1280x720, 640x480, 300x300, 150x100
  - [x] `createThumbnails(image, primaryFile)` — generate all applicable tiers
  - [x] Skip tiers larger than the source image
  - [x] Apply sharpening for ≤300px thumbnails
  - [x] Set JPEG quality: 100% for ≤300px, 90% for larger
  - [x] Write to `.thumbnails` subdirectory with naming convention: `{name}_{width}.jpg`
  - [x] Atomic writes via temp file + rename
  - [x] `getThumbnailDirectory(file)` — return `.thumbnails` path for a given file
  - [x] `getThumbnailPath(file, width)` — return path for a specific thumbnail size
  - [x] `deleteThumbnails(directory)` — recursively delete all `.thumbnails` subdirectories
  - [x] `listThumbnails(mediaId)` — list available thumbnail sizes for a media item
- [x] Write tests for thumbnail generation, tier selection, naming, quality settings

---

## Phase 5: Perceptual Hashing & Duplicate Detection

### pHash Implementation
- [x] Implement `src/services/phash.ts`:
  - [x] `computeHash(image)` — resize to 32x32 grayscale, compute DCT, generate 64-bit hash
  - [x] `hammingDistance(hash1, hash2)` — character comparison on binary hash string
  - [x] DCT implementation (2D discrete cosine transform on 32x32 matrix)
  - [x] Extract top-left 8x8 low-frequency coefficients
  - [x] Generate binary hash string from median comparison
- [x] Write tests for hash computation (known images), Hamming distance calculation

### Hash Matching Service
- [x] Implement hash matching in `src/services/file-index.ts` (or separate `src/services/hash-matcher.ts`):
  - [x] `matchHash(mediaId, hash)` — compare against all existing hashes
  - [x] Two-phase matching: in-memory cache for recent items, then batched DB scan
  - [x] Hamming distance threshold (0 = exact match)
  - [x] Deduplication: skip comparisons where targetId >= sourceId
  - [x] Check for existing match records before inserting
  - [x] Create `media_match` records with match info (hamming_distance, match_date)
- [x] Write tests for matching logic, deduplication, batch scanning

---

## Phase 6: Face Detection & Recognition

### ONNX Runtime Setup
- [x] Install `onnxruntime-node`
- [x] Research and select ONNX models for face detection and recognition
- [x] Document model download/setup instructions
- [x] Implement model loading and session creation

### Face Detection Service
- [x] Implement `src/services/face-detection.ts`:
  - [x] Load face detection ONNX model (YuNet or equivalent)
  - [x] Preprocess image with sharp: resize to model input dimensions, convert to RGB buffer, normalize
  - [x] Run inference via onnxruntime-node
  - [x] Post-process detections: extract bounding boxes, confidence scores, facial landmarks
  - [x] Scale coordinates back to original image dimensions
  - [x] Filter detections by confidence threshold
  - [x] Filter out images with >20 detections (likely false positives)
  - [x] Generate face thumbnail crops (300px max) via sharp
  - [x] Serialize detection data as JSON for database storage
- [x] Write tests for preprocessing, post-processing, coordinate scaling

### Face Recognition Service
- [x] Implement `src/services/face-recognition.ts`:
  - [x] Load face recognition ONNX model (SFace or equivalent)
  - [x] Align and crop face from image using detection landmarks
  - [x] Extract face feature embedding via inference
  - [x] `compareFaces(embedding1, embedding2)` — compute cosine similarity
  - [x] Configurable similarity threshold (default: 0.363)
- [x] Write tests for embedding extraction, cosine similarity computation

### Face Matching Pipeline
- [x] Implement face matching in `src/services/file-index.ts` (or separate `src/services/face-matcher.ts`):
  - [x] `matchFace(featureId)` — compare against all existing face features
  - [x] Two-phase matching: in-memory cache for recent features, then batched DB scan
  - [x] Deduplication: skip comparisons where targetId >= sourceId
  - [x] Check for existing match records before inserting
  - [x] Create `feature_match` records with match info (similarity, match_date)
  - [x] Support `ignore_match` flag for false positives
- [x] Implement transitive face matching:
  - [x] `getMatchingFaces(featureId)` — BFS traversal up to 10 levels deep
  - [x] Return distinct media items for matched features
- [x] Write tests for matching pipeline, transitive matching, deduplication

---

## Phase 7: Media Indexing Pipeline

This is the core indexing engine that ties together all the services from Phases 3–6.

### Notification Service
- [x] Implement `src/services/notification.ts`:
  - [x] EventEmitter-based notification bus
  - [x] `notify(event, source, data)` — emit typed events
  - [x] `addListener(callback)` — register event handlers
  - [x] Event types: create, update, delete (for models), progress (for indexing)
- [x] Write tests for event emission and listener registration

### File Index Service
- [x] Install `p-limit`
- [x] Implement `src/services/file-index.ts`:

#### Path & File Registration
  - [x] `addPaths(directory, fileFilter)` — scan directory, create `path` records, return path IDs
  - [x] `addFiles(pathIds, fileFilter)` — create `file` records for media files, group by name, return ordered file ID groups
  - [x] Skip hidden directories and `_`-prefixed directories
  - [x] Compute MD5 hash for each file

#### Media Item Creation
  - [x] `createMediaItem(fileIds, folderId, folderIndex)` — create or update a media item from a file group
  - [x] Identify primary file from group (HEIC > non-JPEG > JPEG, skip short MOV sidecars)
  - [x] Extract image via sharp (handle images, videos, HEIC)
  - [x] Extract metadata (EXIF/IPTC/GPS for images, ffprobe for videos)
  - [x] Compute perceptual hash
  - [x] Generate thumbnails (5 tiers)
  - [x] Create MP4 for non-MP4 video files
  - [x] Store media item record (name, type, hash, dates, location, metadata)
  - [x] Create `media_item_file` junction records with primary flag
  - [x] Run face detection and store `feature` records with thumbnail crops

#### Folder Management
  - [x] `getOrCreateFolder(directory, parentFolder)` — mirror directory structure as virtual folders
  - [x] Create root folder on initialization
  - [x] Create `folder_entry` records linking media items to folders with sort index

#### Directory Indexing Orchestration
  - [x] `addDirectory(directory, fileFilter, concurrency)` — main entry point
  - [x] Delete orphans before indexing
  - [x] Scan paths and files
  - [x] Process file groups with p-limit concurrency control
  - [x] Queue hash matching after media item creation
  - [x] Queue face matching after feature extraction
  - [x] Emit progress notifications during indexing
  - [x] Wait for all matching operations to complete

#### Orphan Cleanup
  - [x] `deleteOrphans()` — check all DB files against disk, remove missing
  - [x] Delete media items left with no files
  - [x] Delete orphaned thumbnails
  - [x] Delete paths with no files
  - [x] Delete empty folders (recursive)

### Integration Tests
- [x] Test full indexing pipeline with sample image directory
- [x] Test orphan cleanup with deleted files
- [x] Test re-indexing (update existing media items)
- [x] Test file grouping with mixed formats (HEIC + JPG, MOV + MP4)
- [x] Test progress notification emission

---

## Phase 8: Web Server & Core API

### Fastify Server Setup
- [x] Install `fastify`, `@fastify/static`, `@fastify/cors`, `@fastify/websocket`, `@fastify/jwt`, `@fastify/multipart`
- [x] Implement Fastify app factory (`src/server/app.ts`):
  - [x] Create Fastify instance with pino logger
  - [x] Register CORS plugin
  - [x] Register static file serving for web directory
  - [x] Register WebSocket plugin
  - [x] Register JWT plugin
  - [x] Register multipart plugin (for file uploads)
  - [x] Register all route plugins
  - [x] File watching on web directory with debounced notifications

### Authentication
- [x] Install `bcrypt`, `@types/bcrypt`
- [x] Implement JWT auth plugin (`src/server/auth.ts`):
  - [x] `POST /auth/login` — validate credentials, issue JWT
  - [x] `POST /auth/refresh` — refresh expiring token
  - [x] JWT verification `onRequest` hook for protected routes
  - [x] Disabled auth mode: bypass auth when `auth_status` setting is "disabled"
  - [x] Extract user from JWT and attach to request
  - [x] BCrypt password hashing (cost factor 12) for credential storage
- [x] Write tests for login, token verification, disabled auth mode

### WebSocket Event Broadcasting
- [x] Implement WebSocket handler (`src/server/websocket.ts`):
  - [x] Track connected clients in a Map
  - [x] Subscribe to NotificationService events
  - [x] Broadcast events to all connected clients
  - [x] Message format: `action,model,id,userId`
  - [x] Handle client connect/disconnect
- [x] Write tests for event broadcasting, client management

### Settings API
- [x] Implement settings routes (`src/server/routes/settings.ts`):
  - [x] `GET /setting/:key` — retrieve setting value by key (plain text)
  - [x] `POST /setting/:key` — create/update setting (admin only)
  - [x] Validate FFmpeg path on save (attempt to run `ffmpeg -version`)
  - [x] Validate ONNX model paths on save (check file exists and has .onnx extension)
  - [x] Prevent setting deletion
- [x] Write tests for get/save settings, validation, admin-only enforcement

---

## Phase 9: Security & User Management

### Security Filter
- [x] Implement security filter (`src/services/security.ts`):
  - [x] `getAccessLevel(user, component)` — query user_access for permission level
  - [x] Per-model query modification:
    - [x] User: check UserAdmin access for save/delete of other users, protect last admin
    - [x] UserPreference: scope queries to requesting user
    - [x] UserAuthentication: enforce BCrypt hashing on password save, check permissions
    - [x] UserAccess: validate admin count constraints, check UserAdmin permission
    - [x] Component: require SysAdmin for save/delete
    - [x] Datatype: require SysAdmin for save/delete
    - [x] DataAccess: filter by user permissions, enforce read-only
    - [x] Setting: prevent deletion
  - [x] `getAdminCount(excludeUserId, component)` — count remaining admins
- [x] Write tests for each model's security rules, admin protection

### Generic Model CRUD Routes
- [x] Implement CRUD route generator (`src/server/routes/models/`):
  - [x] Auto-register GET (by id), LIST (with pagination), SAVE (create/update), DELETE for each Drizzle table
  - [x] JSON request body parsing
  - [x] Offset/limit pagination via query parameters
  - [x] Apply security filter as preHandler hook per model
  - [x] Emit create/update/delete notifications via NotificationService
- [x] Write tests for CRUD operations, pagination, security enforcement

### User Management Routes
- [x] User CRUD with Person record linkage
- [x] User activity tracking:
  - [x] Increment request counter per user per minute (in-memory)
  - [x] Batch write to `user_activity` table on interval (every 2 minutes)
  - [x] Join last access data on user list queries
- [x] User preference upsert (create or update by key)
- [x] User group management with many-to-many user membership
- [x] Write tests for user creation, activity tracking, preference upsert

---

## Phase 10: Media Serving API

### Image Serving
- [x] Implement image route (`src/server/routes/image.ts`):
  - [x] `GET /image/:id` — serve image by media item ID
  - [x] Support `width` and `height` query parameters for thumbnail selection
  - [x] Find best-fit thumbnail from available sizes
  - [x] Fall back to original file for sizes larger than largest thumbnail
  - [x] Version-based caching: compare `v` and `db` query params, redirect with 301 if stale
  - [x] Set appropriate Content-Type and Last-Modified headers
  - [x] Support path-based media item lookup (resolve by directory + filename)
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
