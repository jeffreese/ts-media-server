# ADR-006: Custom Perceptual Hash Implementation

## Status
Accepted

## Context
The Java version uses `javaxt.io.Image.getPHash()` for perceptual hashing and Hamming distance for duplicate detection. We need a pHash implementation for the Node conversion.

Options considered:
1. **Custom implementation** on top of sharp (~50 lines of TypeScript)
2. **imghash** — npm package, low maintenance
3. **blockhash-core** — perceptual hashing library, different algorithm (block mean vs DCT)

## Decision
We will implement a **custom DCT-based perceptual hash** using sharp for image preprocessing.

## Rationale
- **No extra dependency** — sharp (already in the stack) handles the resize-to-32x32-grayscale step. The DCT computation and hash generation are ~50 lines of straightforward TypeScript.
- **Algorithm stability** — the DCT-based pHash algorithm is well-documented, mathematically defined, and doesn't change. There's no risk of upstream breaking changes.
- **Algorithm match** — `imghash` is unmaintained and `blockhash-core` uses a different algorithm (block mean) that produces incompatible hashes
- **Full control** — easy to debug, tune, and test. Hamming distance comparison is trivial (XOR + popcount).

## Implementation Notes
1. Resize image to 32x32 grayscale using sharp
2. Compute 2D DCT on the pixel values
3. Take the top-left 8x8 DCT coefficients (low frequencies)
4. Compute the median of these 64 values
5. Generate a 64-bit hash: 1 if coefficient > median, 0 otherwise
6. Hamming distance = popcount(hash1 XOR hash2)
