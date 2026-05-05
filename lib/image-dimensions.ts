// ---------------------------------------------------------------------------
// Minimal image-dimensions reader. Handles PNG, JPEG, GIF, and WebP (VP8 /
// VP8L / VP8X). Used by the image-library re-extract endpoint to populate
// width_px / height_px after a bulk upload that didn't capture them.
//
// Pure header parser — no Sharp / image-size dep. Operates on the first
// chunk of bytes (caller can stream the first ~64KB of a Cloudflare
// delivery URL and pass them in). Returns null when the bytes don't look
// like a recognised format or the format-specific marker is missing in
// the supplied prefix.
// ---------------------------------------------------------------------------

export type ImageDimensions = { width: number; height: number };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;

  if (matchesAt(bytes, 0, PNG_SIG)) return readPng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return readGif(bytes);
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return readWebp(bytes);
  }
  return null;
}

function matchesAt(buf: Uint8Array, offset: number, sig: number[]): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

function readPng(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  const width = readUint32BE(b, 16);
  const height = readUint32BE(b, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readJpeg(b: Uint8Array): ImageDimensions | null {
  // Walk JPEG segments: each marker is FF Mn followed (for non-SOI/EOI)
  // by a 2-byte big-endian length that includes the length bytes
  // themselves. SOF markers FF C0..FF CF (excluding C4 / C8 / CC) carry
  // dimensions: 1 byte precision, 2 bytes height (BE), 2 bytes width (BE).
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (marker === 0xda) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (i + 9 >= b.length) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

function readGif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readWebp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8 ") {
    if (b.length < 30) return null;
    const width = ((b[26] | (b[27] << 8)) & 0x3fff);
    const height = ((b[28] | (b[29] << 8)) & 0x3fff);
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (fourcc === "VP8L") {
    if (b.length < 25) return null;
    const w = (b[21] | (b[22] << 8)) & 0x3fff;
    const h = ((b[22] >> 6) | (b[23] << 2) | (b[24] << 10)) & 0x3fff;
    return { width: w + 1, height: h + 1 };
  }
  if (fourcc === "VP8X") {
    if (b.length < 30) return null;
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

function readUint32BE(b: Uint8Array, offset: number): number {
  return (
    (b[offset] * 0x1000000) +
    (b[offset + 1] << 16) +
    (b[offset + 2] << 8) +
    b[offset + 3]
  );
}

const ISTOCK_FILENAME_RE = /iStock[-_](\d{6,})/i;

/**
 * Extract a numeric iStock asset id from a filename like
 * `iStock-2216481617.jpg` or `istock_1234567890_v1.jpeg`. Returns null
 * when the filename doesn't carry an iStock prefix.
 */
export function parseIstockIdFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const m = ISTOCK_FILENAME_RE.exec(filename);
  return m?.[1] ?? null;
}
