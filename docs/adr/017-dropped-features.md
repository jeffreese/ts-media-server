# ADR-017: Dropped and Deferred Features

## Status
Accepted

## Context
Not all features from the Java version need to be carried forward to the Node conversion. Some add complexity without sufficient value, and some can be deferred to a later phase.

## Decisions

### Dropped: Remote Host Proxy
The Java version can forward all API and WebSocket requests to a configurable remote host, acting as a reverse proxy. This appears designed for separating frontend and backend tiers.

**Reason for dropping:** Niche deployment pattern that adds significant complexity (HTTP proxying, WebSocket forwarding, SSL certificate handling). Standard reverse proxies (nginx, Caddy) handle this better if needed.

### Dropped: SQL Query Endpoint (`/sql`)
The Java version exposes a `/sql` endpoint for executing arbitrary SQL queries with async job processing and WebSocket notifications.

**Reason for dropping:** Significant security surface. Admin users can use standard SQLite tools (DB Browser for SQLite, `sqlite3` CLI) for ad-hoc queries. The application doesn't need to be a SQL client.

### Dropped: Custom RRD Thumbnail Format
See ADR-007 for the full rationale. Replaced with individual JPEG files per resolution tier.

### Dropped: ImageMagick Dependency
See ADR-004 for the full rationale. Replaced by sharp.

### Dropped: Openize HEIC Fallback
The Java version uses Openize as a pure-Java HEIC decoder when ImageMagick is unavailable. Sharp handles HEIC natively via libheif, eliminating the need for a fallback.

### Dropped: H2 / Dual Database Support
The Java version supports both PostgreSQL and H2. We use SQLite exclusively (ADR-001), eliminating database-specific code paths.

### Deferred: Email Service
The Java version has email service configuration stored in the database. This is not needed for core media server functionality.

**Plan:** Add email support in a future phase if needed for features like user invitations or notifications.

### Deferred: HEIC-to-JPEG Batch Conversion CLI
The Java version's `-convert` command creates JPEGs alongside HEIC files. Since sharp handles HEIC natively, the indexer can work with HEIC files directly. If users need standalone conversion, it can be added later.
