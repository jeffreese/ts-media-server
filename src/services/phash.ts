import type sharp from 'sharp';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HASH_SIZE = 8;
const DCT_SIZE = 32;

// ---------------------------------------------------------------------------
// Pre-computed DCT coefficient matrix
// ---------------------------------------------------------------------------

/**
 * Build the DCT-II coefficient matrix for a given size N.
 * Entry [u][x] = cos((2x + 1) * u * π / (2N)), with the standard
 * orthonormal scaling (√(1/N) for u=0, √(2/N) otherwise).
 */
function buildDctCoefficients(n: number): Float64Array[] {
  const coefficients: Float64Array[] = new Array(n);
  const scale0 = Math.sqrt(1 / n);
  const scaleK = Math.sqrt(2 / n);

  for (let u = 0; u < n; u++) {
    coefficients[u] = new Float64Array(n);
    const scale = u === 0 ? scale0 : scaleK;
    for (let x = 0; x < n; x++) {
      coefficients[u][x] = scale * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
  }

  return coefficients;
}

const DCT_COEFFICIENTS = buildDctCoefficients(DCT_SIZE);

// ---------------------------------------------------------------------------
// DCT
// ---------------------------------------------------------------------------

/**
 * Apply a 2D DCT-II to a 32×32 matrix of pixel values and return the
 * top-left 8×8 block of low-frequency coefficients.
 */
function dct2d(pixels: Float64Array): Float64Array {
  const temp = new Float64Array(DCT_SIZE * DCT_SIZE);

  // Row-wise 1D DCT → temp
  for (let y = 0; y < DCT_SIZE; y++) {
    const rowOffset = y * DCT_SIZE;
    for (let u = 0; u < DCT_SIZE; u++) {
      const coeffRow = DCT_COEFFICIENTS[u];
      let sum = 0;
      for (let x = 0; x < DCT_SIZE; x++) {
        sum += pixels[rowOffset + x] * coeffRow[x];
      }
      temp[y * DCT_SIZE + u] = sum;
    }
  }

  // Column-wise 1D DCT on temp → result (only first HASH_SIZE rows needed)
  const result = new Float64Array(HASH_SIZE * HASH_SIZE);
  for (let u = 0; u < HASH_SIZE; u++) {
    const coeffRow = DCT_COEFFICIENTS[u];
    for (let v = 0; v < HASH_SIZE; v++) {
      let sum = 0;
      for (let y = 0; y < DCT_SIZE; y++) {
        sum += temp[y * DCT_SIZE + v] * coeffRow[y];
      }
      result[u * HASH_SIZE + v] = sum;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute a 64-bit perceptual hash for an image.
 *
 * Pipeline: resize to 32×32 grayscale → 2D DCT → extract top-left 8×8
 * low-frequency coefficients → compare each to the median → produce a
 * 64-character binary string ("0"/"1").
 *
 * @param image - A sharp instance (already auto-rotated).
 * @returns A 64-character binary string representing the perceptual hash.
 */
export async function computeHash(image: sharp.Sharp): Promise<string> {
  const { data } = await image
    .clone()
    .greyscale()
    .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = data[i];
  }

  const dctBlock = dct2d(pixels);

  // Exclude DC coefficient (index 0) from median to avoid bias from
  // overall brightness, but include it in the final hash comparison.
  const acValues = dctBlock.slice(1);
  const sorted = Float64Array.from(acValues).sort();
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const bits: string[] = new Array(HASH_SIZE * HASH_SIZE);
  for (let i = 0; i < dctBlock.length; i++) {
    bits[i] = dctBlock[i] > median ? '1' : '0';
  }

  return bits.join('');
}

// ---------------------------------------------------------------------------
// Hamming distance
// ---------------------------------------------------------------------------

/**
 * Compute the Hamming distance between two 64-character binary hash strings.
 * Returns the number of bit positions where the hashes differ (0 = identical).
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error(
      `Hash length mismatch: ${hash1.length} vs ${hash2.length}`,
    );
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }

  return distance;
}
