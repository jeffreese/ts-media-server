# ADR-001: SQLite + SpatiaLite as the Database

## Status
Accepted

## Context
The Java version supports PostgreSQL (with PostGIS) for production and H2 (embedded) for development. For the Node/TypeScript conversion, we need to choose a database strategy.

Options considered:
1. **PostgreSQL + PostGIS** — direct port of the Java production database
2. **SQLite only** — zero-config embedded database, simplest deployment
3. **SQLite + SpatiaLite** — embedded database with geospatial support
4. **Dual database (PostgreSQL + SQLite)** — production vs dev split

## Decision
We will use **SQLite with the SpatiaLite extension** as the sole database.

## Rationale
- **Zero-config deployment** — SQLite is a file-based database requiring no server process, which simplifies installation for a self-hosted media server
- **SpatiaLite preserves geospatial fidelity** — the Java schema uses PostGIS geometry types with spatial indexes; SpatiaLite provides equivalent geometry types, WKT parsing, and R-tree spatial indexes on SQLite
- **Schema portability** — the Java schema translates nearly 1:1 to SQLite + SpatiaLite, keeping the data model faithful to the original
- **Single database simplifies the stack** — no need for database-specific code paths or compatibility layers

## Tradeoffs
- **Concurrent writes** — SQLite is single-writer. We mitigate this with WAL mode, `busy_timeout`, and serialized write queues where needed. The Java version's multi-threaded write patterns will need adaptation.
- **SpatiaLite is a native extension** — requires installation on the host system (`brew install spatialite-tools` on macOS, `apt install libsqlite3-mod-spatialite` on Ubuntu). This is an acceptable burden for a server that already requires FFmpeg.
- **No JSONB** — SQLite stores JSON as text. Drizzle supports JSON mode for text columns, so the application layer is unaffected, but we lose PostgreSQL's JSON indexing and query operators.
