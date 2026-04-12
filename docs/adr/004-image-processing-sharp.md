# ADR-004: sharp for Image Processing (Replacing ImageMagick)

## Status
Accepted

## Context
The Java version uses three tools for image processing:
- **Java AWT** — native image loading, resizing, rotation
- **ImageMagick** — format conversion (HEIC, TIFF → JPEG), EXIF extraction, image dimensions
- **Openize** — pure-Java HEIC fallback when ImageMagick is unavailable

For the Node conversion, we need to choose an image processing library.

Options considered:
1. **sharp** (libvips) — fast, native, handles JPEG/PNG/WebP/TIFF/HEIF natively
2. **Jimp** — pure JS, no native deps, but slow
3. **ImageMagick bindings** (`gm`) — wraps the same CLI tool
4. **sharp + ImageMagick** — sharp for most work, ImageMagick for edge cases

## Decision
We will use **sharp** as the sole image processing library, eliminating ImageMagick and Openize as dependencies.

## Rationale
- **Format coverage** — sharp handles JPEG, PNG, WebP, TIFF, and HEIF/HEIC natively via libvips/libheif. This covers every format the Java version supports.
- **Performance** — sharp/libvips is faster than ImageMagick for resize, conversion, and thumbnail generation. It maintains its own thread pool for parallel processing.
- **Feature coverage** — sharp provides resize, rotate, sharpen, crop, format conversion, and metadata extraction. This covers all operations the Java version performs.
- **Fewer system dependencies** — eliminates the need to install ImageMagick on the host system
- **EXIF supplement** — for extended EXIF fields sharp doesn't expose (lens make/model, azimuth), we supplement with `exifr`, a pure-JS library with no native dependencies

## Tradeoffs
- **Native dependency** — sharp requires a native build (prebuilt binaries available for all major platforms). This is generally seamless but can complicate exotic deployment targets.
- **No ImageMagick fallback** — if sharp can't handle a format, there's no secondary tool. In practice, libvips format support is broader than what this application needs.
