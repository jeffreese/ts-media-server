# ADR-009: Commander.js for CLI

## Status
Accepted

## Context
The Java version has a custom argument parser in `Main.java` that branches on flags like `-add`, `-delete`, `-test`, `-query`, or defaults to starting the web server.

Options considered:
1. **Commander.js** — most popular, mature, subcommand support, auto-generated help
2. **yargs** — powerful but verbose
3. **citty** — lightweight, TypeScript-first
4. **Custom** — minimal arg parsing

## Decision
We will use **Commander.js**.

## Rationale
- **Subcommand support** — maps naturally to the Java version's command structure (`serve`, `add`, `delete`, `test`)
- **Auto-generated help** — `--help` output for free
- **Mature and stable** — widely used, well-documented, minimal maintenance risk
- **Right-sized** — not overkill for our ~6 subcommands, but provides structure the custom approach lacks

## Command Structure
```
media-server serve [options]              # Start web server
media-server add directory --path <dir>   # Index a directory
media-server delete thumbnails --path <dir>
media-server delete orphans
media-server test ffmpeg
media-server test metadata --file <path>
media-server test faces --file <path>
```
