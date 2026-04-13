# JavaXT Media Server — Feature List

## 1. Media Indexing & Cataloging

### Directory Indexing
- Recursively scans directories for photos and videos
- Multi-threaded file processing with configurable thread count
- Groups related files by name (e.g. HEIC + JPG sidecar, MOV + MP4)
- Identifies primary media file from file groups (prioritizes HEIC, then non-JPEG, then JPEG)
- Handles iPhone sidecar files (AAE, MOV short clips, "IMG_E" cropped variants)
- Skips hidden directories and directories starting with `_` or `.`
- Tracks files by host, path, name, extension, size, date, and MD5 hash

### Supported Image Formats
- JPEG (jpg, jpeg, jpe, jfif)
- PNG
- WebP
- TIFF (via TwelveMonkeys)
- HEIC/HEIF (via ImageMagick or Openize fallback)

### Supported Video Formats
- MOV, MTS, M4V, MP4, WebM, OGG

### Metadata Extraction
- EXIF parsing (date, orientation, camera make/model, lens make/model, focal length, aperture, f-stop, shutter speed, exposure time, ISO speed)
- IPTC tag extraction
- GPS coordinate extraction (latitude, longitude, datum, azimuth) with WGS84/PostGIS geometry storage
- Video metadata via FFmpeg (date, width, height, duration, frame rate)
- Sidecar JPEG metadata fallback for formats without embedded EXIF (e.g. older iPads)

### Orphan Cleanup
- Detects files in the database that no longer exist on disk
- Removes orphaned media items left with no files
- Deletes orphaned thumbnails (RRD files) when source media is gone
- Removes empty paths and folders from the database


## 2. Thumbnail Generation

### Multi-Resolution Thumbnails (RRD Format)
- Custom RRD (Reduced Resolution Dataset) image file format
- Stores multiple resolutions in a single file with an indexed header
- Predefined resolution tiers: 3840x2160, 2560x1440, 1920x1080, 1536x864, 1366x768, 1280x720, 1024x768, 800x600, 300x300, 150x100
- Automatic image sharpening for small thumbnails (≤300px)
- Higher quality output (100%) for small thumbnails, 90% for larger sizes
- Supports rotation (clockwise, counter-clockwise, arbitrary degrees)

### Thumbnail Management
- Thumbnails stored in `.thumbnails` subdirectory alongside source files
- Atomic file creation via temp files with rename
- Bulk thumbnail deletion via maintenance CLI command
- On-demand thumbnail regeneration for indexed files missing thumbnails


## 3. Face Detection & Recognition

### Face Detection (OpenCV + YuNet ONNX Model)
- Detects faces in images using OpenCV's FaceDetectorYN with YuNet ONNX model
- Automatic image resizing to 600px max width for detection performance
- Coordinate scaling back to original image dimensions
- Stores face bounding box coordinates, confidence score, and detection Mat as JSON
- Generates 300px max face thumbnail crops stored as binary in the database
- Per-thread FaceDetectorYN instances (not thread-safe, so each thread gets its own)
- Retry logic (up to 5 attempts) for face detection
- Filters out images with more than 20 detected faces (likely false positives)

### Facial Recognition (OpenCV FaceRecognizerSF)
- Compares detected faces using cosine distance similarity
- Configurable similarity threshold (default: 0.363)
- Transitive face matching — finds indirect matches up to 10 levels deep
- Stores match records with similarity scores and match dates
- Supports ignoring false-positive matches (`ignore_match` flag)

### Face Matching Pipeline
- Asynchronous matching via dedicated thread pools (CPU-count-aware sizing)
- Two-phase comparison: first against recently indexed items (in-memory cache), then against the full database in batches
- Deduplication: skips comparisons where target ID < source ID
- Checks for existing match records before inserting duplicates
- Real-time notifications via NotificationService on new matches

### Person-Feature Linking
- Features (faces) can be linked to Person records
- Supports multiple names per person with preferred name designation


## 4. Perceptual Hash Matching

### Duplicate Detection
- Generates perceptual hashes (pHash) for images
- Compares hashes using Hamming Distance (exact match = distance 0)
- Two-phase matching: in-memory cache for recent items, then batched database scan
- Stores match records with Hamming distance and match date
- Supports ignoring false-positive matches (`ignore_match` flag)
- Asynchronous matching via dedicated thread pool


## 5. Video Processing

### FFmpeg Integration
- Extracts still frames from videos (at 4-second mark) for thumbnails
- Converts non-MP4 videos to MP4 for web streaming (H.264 + AAC)
- MOV-to-MP4 conversion uses stream copy for efficiency
- Other formats use libx264 encoding with yuv420p pixel format and faststart flag
- Extracts video duration via ffprobe
- Extracts video metadata (creation time, dimensions, duration, frame rate) via ffprobe

### ImageMagick Integration
- Converts unsupported image formats (HEIC, TIFF, etc.) to JPEG
- Extracts EXIF metadata from images
- Retrieves image dimensions efficiently via `-ping` option
- Handles multi-page images (picks largest output file)

### HEIC Support (Openize Fallback)
- Pure-Java HEIC decoding via Openize library when ImageMagick is unavailable
- Converts HEIC to JPEG using ARGB32 pixel format


## 6. Web Server

### HTTP Server
- Embedded HTTP server (javaxt.http.Server)
- Configurable port (default: 8080) and thread count (default: 250)
- HTTPS support via JKS keystore with automatic HTTP-to-HTTPS redirect
- CORS support (Access-Control-Allow-Origin: *)
- Content-Security-Policy header for HTTPS (`upgrade-insecure-requests`)
- Static file serving from configurable web directory
- Web request logging to configurable log directory
- File change watching on the web directory with debounced notifications
- SPA fallback: serves `index.html` for non-file routes when web directory is configured

### Web Frontend (React SPA)
- React 19 + Vite 6 + TypeScript SPA served by Fastify via `@fastify/static`
- Tailwind CSS 4 with semantic design tokens, dark-first theme with light mode toggle
- Folder browsing with folder cards and responsive thumbnail grid
- Full-screen image lightbox with keyboard navigation (arrows, Escape) and info panel
- Video playback with poster thumbnail
- People page with face avatar grid, person detail with linked photos
- Settings page with theme toggle
- Breadcrumb navigation, sidebar with section links
- Error boundary with friendly 404 page

### WebSocket Support
- Real-time event broadcasting to connected WebSocket clients
- Notifications for CRUD operations on all models
- Notifications for SQL query job completion
- Notifications for web file changes
- Notifications for web request activity
- WebSocket proxy forwarding to remote hosts

### Remote Host Proxy
- Forwards API requests to a configurable remote host
- Proxies both HTTP and WebSocket connections
- Preserves request headers and authorization
- SSL certificate validation bypass for IP-based hosts


## 7. REST API

### Media Endpoints
- `GET /image` — Serve images with optional width/height parameters for responsive thumbnails; supports version-based caching with 301 redirects
- `GET /video` — Serve MP4 video files with version-based caching
- `GET /face` — Serve face thumbnail images by feature ID
- `GET /matchingFaces` — Find media items matching a given face via transitive feature matching with pagination
- `GET /thumbnails` — List available thumbnail sizes for a media item
- `GET /index` — Browse folder hierarchy with optional recursive listing and pagination
- `GET /mediaItem` — Retrieve media item details (files excluded from response)

### Generic Model CRUD
- Auto-registered REST endpoints for all 33 database models
- Standard get, list, save, delete operations via javaxt-express WebService
- JSON payload parsing with multipart/form-data support for uploads
- Offset/limit pagination support

### SQL Query Service
- Direct SQL query execution via `/sql` endpoint
- Query results exported to temp directory
- Async query job processing with WebSocket notifications on completion

### File Browser Service
- `GET /dir` — Browse server filesystem (admin only)
- `POST /dir/upload` — Upload files to server (admin only)
- `GET /dir/download` — Download files from server (admin only)

### Settings API
- `GET /setting` — Retrieve setting value by key (plain text response)
- `POST /setting` — Create/update settings with validation for ImageMagick, FFmpeg, and ONNX model paths (admin only)


## 8. Authentication & Authorization

### Authentication
- Basic HTTP authentication with BCrypt password hashing
- Disableable authentication mode (default for fresh installs)
- User credentials stored in `user_authentication` table with service-based key/value pairs
- Session-based user caching via authenticator

### Role-Based Access Control
- Component-based permission system (SysAdmin, UserAdmin, Media, Contact)
- 5-level access hierarchy per component per user
- Admin-only endpoints enforced via SecurityFilter
- Protection against deleting the last admin user
- Users can only edit their own profile unless they have UserAdmin access

### Per-Model Security Filtering
- Custom query modification per model type in SecurityFilter
- User list queries can join access level and last activity data
- UserPreference scoped to the requesting user
- UserAuthentication password hashing enforced on save
- UserAccess changes validated against admin count constraints
- Dataset access filtered by user permissions with read-only enforcement
- Settings cannot be deleted via API


## 9. User Management

### User Model
- Users linked to Person records (gender, birthday, info)
- Person supports multiple names, addresses, contacts, and features
- User status field for account activation/deactivation
- User groups with many-to-many user membership and admin flag

### User Activity Tracking
- Per-user request counting aggregated by hour and minute (UTC)
- Batched database writes every 2 minutes via timer task
- Activity data queryable for "last access" reporting on user lists

### User Preferences
- Key-value preference storage scoped per user
- Upsert behavior (creates or updates based on existing key)

### User Ratings
- Per-user, per-media-item ratings with optional comments and timestamps


## 10. File & Folder Organization

### Virtual Folder Hierarchy
- Mirrors source directory structure as a virtual folder tree in the database
- Root folder with nested subfolders matching filesystem layout
- Folder entries link media items to folders with sort index
- Recursive subfolder querying for folder contents

### Media Item File Management
- Many-to-many relationship between media items and files
- Primary file designation per media item
- Supports moving media items between directories with file integrity verification (SHA1 checksums)
- Directory merging: combines media from multiple source directories into one, renaming files by date
- Atomic file operations: copy first, verify, then delete originals; rollback on failure


## 11. Geospatial Support

### PostGIS Integration
- Media item locations stored as PostGIS geometry (SRID 4326)
- Spatial index on media item locations (GiST)
- Place records with geometry locations and spatial indexing
- Place-to-media linking for location-based organization
- Address model with street, city, state, postal code linked to places
- GPS coordinate parsing from both EXIF tags and ImageMagick output


## 12. Data Management

### Generic Data Store
- Typed data records with custom datatypes
- JSON data payload with optional binary thumbnails
- Group-based access control with read-only permissions

### Keywords
- Keyword tagging for media items (many-to-many)
- Unique keyword enforcement

### Media Logging
- Action-based audit log per media item per user with timestamps


## 13. Database

### Dual Database Support
- PostgreSQL (production) with PostGIS extension
- H2 (embedded, development) in PostgreSQL compatibility mode
- Automatic schema initialization from SQL file
- Connection pool with auto-sizing based on model count
- Metadata caching for performance

### Configuration
- JSON-based configuration file (`config.json`)
- Relative path resolution for web directory, log directory, keystore, database, and ONNX models
- Settings persisted to database (ImageMagick path, FFmpeg path, face detection/recognition model paths, email config, auth status)
- Email service configuration stored in database after initial load


## 14. Command-Line Interface

### Server Mode
- `java -jar media-server.jar` — Start the web server
- `-port` / `-p` — Set HTTP port
- `-threads` / `-t` — Set max server threads
- `-web` / `-w` — Set web directory path
- `-config` — Specify config file path

### Indexing Mode
- `-add directory -path /path` — Index a directory of photos and videos
- `-threads` / `-t` — Set indexing thread count
- Progress reporting via NotificationService with status logger

### Maintenance Mode
- `-delete thumbnails -path /path` — Delete all `.thumbnails` directories
- `-delete orphans` — Remove database entries for files no longer on disk
- `-query "SQL"` — Execute arbitrary SQL queries against the database

### Test Mode
- `-test ImageMagick` — Verify ImageMagick installation
- `-test FFmpeg` — Verify FFmpeg installation
- `-test metadata -file /path` — Extract and display metadata from a file
- `-test faces -file /path` — Detect faces and render bounding boxes on an image
- `-test faceComparison -file /path -file2 /path` — Compare faces between two images
- `-test fileDates -path /path` — Validate file dates in a directory
- `-test heic -path /path` — Test HEIC-to-JPEG conversion via Openize

### Conversion Mode
- `-convert /path` — Create JPEGs alongside HEIC files (single file or directory, multi-threaded)


## 15. Notification System

### Event-Driven Architecture
- Central NotificationService for inter-component communication
- Event types: create, update, delete for all models
- Listeners for file indexing progress, SQL query completion, web file changes, and web requests
- WebSocket broadcast of all events to connected clients
- Used for CLI progress reporting during directory indexing


## 16. Cross-Platform Support

### Operating System Compatibility
- Windows, macOS, Linux support
- Platform-specific path handling (backslash normalization, space escaping)
- OpenCV native library auto-extraction from JAR (dll, dylib, so)
- Architecture support: x86_32, x86_64, ARMv7, ARMv8/aarch64
