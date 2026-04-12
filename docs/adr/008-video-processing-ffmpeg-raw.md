# ADR-008: FFmpeg via Raw child_process (No Wrapper Library)

## Status
Accepted

## Context
The Java version shells out to `ffmpeg` and `ffprobe` as external binaries via `javaxt.io.Shell`. We need to decide how to invoke FFmpeg from Node.js.

Options considered:
1. **fluent-ffmpeg** — popular npm wrapper with chainable API, progress events, error parsing
2. **Raw `child_process.execFile`** — direct process spawning, no abstraction

## Decision
We will use **raw `child_process.execFile`** calls wrapped in a thin `FFmpeg` utility class.

## Rationale
- **Simple use cases** — the application uses exactly 5 FFmpeg commands: extract a frame, convert to MP4 (two variants: stream copy and re-encode), get metadata via ffprobe, and get duration via ffprobe. These are straightforward commands that don't benefit from a fluent API.
- **Transparency** — the exact CLI arguments are visible in the code, matching the Java version's approach. No abstraction layer to debug through.
- **No extra dependency** — `child_process` is built into Node.js
- **Matches the Java pattern** — the Java version builds command strings and shells out. The Node version does the same with `execFile` (which is safer than shell execution since it avoids shell injection).

## Implementation Notes
The `FFmpeg` utility class will provide:
- `createJPEG(input, output)` — extract frame at 4s mark
- `createMP4(input, output)` — transcode to MP4
- `getMetadata(file)` — parse ffprobe JSON output
- `getDuration(file)` — extract duration
- `isMovie(file)` — check file extension against known video formats
- `validate()` — confirms ffmpeg/ffprobe are reachable by running `-version` (async; called after construction since JS constructors cannot be async)
