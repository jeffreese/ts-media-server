# ADR-007: Individual JPEG Files for Thumbnails (Replacing RRD Format)

## Status
Accepted

## Context
The Java version uses a custom RRD (Reduced Resolution Dataset) binary format that packs multiple JPEG resolutions into a single file with an indexed header. We need to decide on a thumbnail storage strategy.

Options considered:
1. **Re-implement RRD** — port the custom binary format to Node
2. **Individual JPEG files** — one file per resolution tier
3. **Single high-res thumbnail + on-the-fly resize** — store one, resize at request time

## Decision
We will store thumbnails as **individual JPEG files**, one per resolution tier, with **5 resolution tiers** (down from 10 in the Java version).

## Resolution Tiers
| Name | Max Dimensions | Use Case |
|---|---|---|
| Large | 1920x1080 | Full-screen viewing |
| Medium | 1280x720 | Gallery detail view |
| Small | 640x480 | Grid view |
| Thumb | 300x300 | Small thumbnail |
| Micro | 150x100 | Tiny preview, face crops |

Larger sizes (2560+) are served from the original file.

## Rationale
- **Simplicity** — standard JPEG files are trivial to create (sharp), serve (Fastify static), inspect (any image viewer), and manage (filesystem operations)
- **Direct serving** — Fastify can serve thumbnails as static files with ETags and caching headers, zero custom code. RRD requires parsing the header, seeking to the right offset, and streaming a chunk.
- **Debuggability** — individual files can be opened, viewed, and verified with standard tools. RRD is a proprietary format only this application understands.
- **CDN-friendly** — individual files work naturally with CDNs and reverse proxies
- **5 tiers vs 10** — the 6 desktop sizes (3840 down to 1280) are redundant when the original file can serve the largest sizes. 5 tiers cover the practical use cases.

## Tradeoffs
- **More files on disk** — up to 5 files per media item instead of 1. For 100K photos this is 500K thumbnail files, which is a non-issue on modern filesystems.
- **More filesystem operations** — moving or deleting a media item requires handling 5 thumbnail files instead of 1. Mitigated by keeping all thumbnails in a `.thumbnails` subdirectory.

## Storage Layout
```
/path/to/photos/
├── IMG_0001.jpg           # Original
├── .thumbnails/
│   ├── IMG_0001_1920.jpg  # Large
│   ├── IMG_0001_1280.jpg  # Medium
│   ├── IMG_0001_640.jpg   # Small
│   ├── IMG_0001_300.jpg   # Thumb
│   └── IMG_0001_150.jpg   # Micro
```
