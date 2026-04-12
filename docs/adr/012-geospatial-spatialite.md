# ADR-012: SpatiaLite for Geospatial Support

## Status
Accepted

## Context
The Java version uses PostgreSQL with PostGIS for geospatial data: `geometry(Geometry,4326)` columns on `media_item` and `place` tables, GiST spatial indexes, and WKT parsing via JTS. Since we chose SQLite as the database (ADR-001), we need an alternative for geospatial support.

Options considered:
1. **SpatiaLite** — SQLite extension providing PostGIS-like geometry types and spatial indexing
2. **Plain lat/lng columns** — two REAL columns, Haversine formula in application code
3. **GeoJSON text columns** — flexible but no spatial indexing
4. **Switch to PostgreSQL** — considered but rejected in favor of SQLite's zero-config deployment

## Decision
We will use **SpatiaLite** as a SQLite extension for geospatial support.

## Rationale
- **Schema fidelity** — the Java schema uses proper geometry types with spatial indexes. SpatiaLite provides equivalent types (`GEOMETRY`, `POINT`), WKT functions (`GeomFromText`, `AsText`, `ST_X`, `ST_Y`), and R-tree spatial indexes. The schema translates nearly 1:1.
- **Future-proofing** — plain lat/lng columns would require restructuring the Place model and make it impossible to add spatial queries (bounding box, nearest neighbor) without a migration
- **Consistency with the Java design** — the original schema was designed around geometry types. Preserving this makes the codebase easier to reason about for anyone familiar with the Java version.

## Tradeoffs
- **Native extension** — SpatiaLite must be installed on the host system:
  - macOS: `brew install spatialite-tools`
  - Ubuntu/Debian: `apt install libsqlite3-mod-spatialite`
  - Windows: download `mod_spatialite.dll`
  
  This is an acceptable burden for a self-hosted server that already requires FFmpeg.
- **Drizzle integration** — Drizzle doesn't have first-class SpatiaLite support. Geometry columns will be defined via raw SQL in migrations, and spatial queries will use Drizzle's `sql` template literal for raw SQL fragments.
- **Loading the extension** — `better-sqlite3` supports loading extensions via `.loadExtension()`. The SpatiaLite module path will be configurable (with auto-detection for common install locations).
