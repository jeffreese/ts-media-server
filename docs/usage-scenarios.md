# Usage Scenarios

## What It Is

`ts-media-server` is a **self-hosted media server** for personal photo and video libraries. You point it at directories on disk and it indexes the media, extracts metadata, generates thumbnails, detects faces, finds near-duplicates, and serves everything through a REST API and WebSocket interface. Think of it as the back-end engine for a personal Google Photos-style application.

---

## Scenario 1: First-Time Setup — Index Your Photo Library

You have a directory of photos and videos (e.g., from an iPhone export or a NAS) and want to catalog them.

```bash
# Build the project
pnpm build

# Index a photo directory
media-server add directory --path ~/Pictures/Family

# Start the server to browse the library
media-server serve
```

The `add directory` command recursively scans the folder, registers every media file in an SQLite database, extracts EXIF/GPS/video metadata, generates thumbnails at 5 resolutions, computes perceptual hashes to find near-duplicates, and (if ONNX models are configured) detects and matches faces. Progress is printed in real time.

## Scenario 2: Running the Server for a Front-End Client

Once media is indexed, you start the server so a web or mobile client can browse and display the library.

```bash
media-server serve --port 3000 --config ~/media-config.json
```

A client application can then:
- **Browse folders** via `GET /index/Photos/2024` (mirrors your directory structure)
- **Display images** via `GET /image/:id` or `GET /image?dir=...&file=...` (full-size or thumbnail by `?width=&height=`)
- **Stream video** via `GET /video/:id` (supports HTTP range requests for seeking)
- **Show face crops** via `GET /face/:id`
- **Get media details** via `GET /media-item/:id` (camera model, date, GPS coordinates, linked files)
- **Receive real-time updates** by connecting to `ws://localhost:3000/ws` (notified when new items are indexed, faces matched, etc.)

## Scenario 3: Multi-Directory Library

You have media spread across several drives or directories. You index each one separately:

```bash
media-server add directory --path /Volumes/Photos/2020
media-server add directory --path /Volumes/Photos/2021
media-server add directory --path /Volumes/Photos/Vacation
media-server add directory --concurrency 8 --path /Volumes/DCIM
```

The `--concurrency` flag controls how many files are processed in parallel (defaults to CPU core count). All directories feed into the same SQLite database, so the unified library is browsable through a single server instance.

## Scenario 4: Re-Indexing and Maintenance

Over time, files get moved or deleted. The server provides cleanup commands:

```bash
# Remove database records for files that no longer exist on disk
media-server delete orphans

# Regenerate thumbnails for a directory (e.g., after changing thumbnail sizes in config)
media-server delete thumbnails --path ~/Pictures/Family
media-server add directory --path ~/Pictures/Family
```

## Scenario 5: API-Driven Indexing (Headless/Remote)

Instead of using the CLI, a front-end admin panel can trigger operations via the REST API:

```bash
# Trigger indexing from an HTTP client
curl -X POST http://localhost:8080/dir/index \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"path": "/data/photos/new-imports"}'

# Clean up orphaned records
curl -X DELETE http://localhost:8080/dir/orphans \
  -H "Authorization: Bearer <jwt>"
```

The WebSocket endpoint (`/ws`) pushes progress events so the client can show a real-time indexing progress bar.

## Scenario 6: Diagnosing Setup Issues

Before indexing, you can verify that external dependencies are working:

```bash
# Check FFmpeg is installed and accessible
media-server test ffmpeg

# Test metadata extraction on a single file
media-server test metadata --file ~/Pictures/IMG_1234.HEIC

# Test face detection on a single image
media-server test faces --file ~/Pictures/portrait.jpg
```

## Scenario 7: User Management and Access Control

The server supports multi-user access with JWT authentication and role-based permissions:

```bash
# Login to get a token
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret"}'
# → {"token": "eyJ..."}

# Use the token for authenticated requests
curl http://localhost:8080/index \
  -H "Authorization: Bearer eyJ..."

# CRUD any of the 27+ database models via generic endpoints
curl http://localhost:8080/person?limit=10
curl http://localhost:8080/keyword
curl -X POST http://localhost:8080/user_rating \
  -H "Authorization: Bearer eyJ..." \
  -d '{"mediaItemId": 42, "rating": 5}'
```

Roles control who can browse files, manage users, or access admin features like the file browser (`/dir`).

## Scenario 8: Face Recognition Workflow

With ONNX models configured (YuNet for detection, SFace for recognition), the indexing pipeline automatically:

1. Detects faces in every image and stores bounding boxes + thumbnail crops
2. Extracts face embeddings (feature vectors)
3. Matches faces across the library using cosine similarity
4. Links matches transitively (if face A matches B, and B matches C, then A-B-C are grouped)

A client can then associate face groups with named people via the `person_feature` model, enabling "photos of this person" browsing.

---

## Summary

The typical workflow is: **index directories** → **start the server** → **consume the API** from a front-end. The CLI handles offline batch operations (indexing, cleanup, diagnostics), while the HTTP server handles real-time browsing, media serving, and management for connected clients.
