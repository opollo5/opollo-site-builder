// ---------------------------------------------------------------------------
// Spec 09 — Image filename generator for the WP publish pipeline.
//
// Produces collision-resistant SEO-friendly filenames from the post title,
// the original library filename (for the extension), the image's index
// in the post (0 = featured), and the post id (for a deterministic
// short-hash suffix). Same post + same imageIndex → same filename, so
// re-publish overwrites cleanly without orphaning the previous upload.
// Different posts with similar titles get different hashes — no
// cross-post collisions on the WP side.
// ---------------------------------------------------------------------------

const FILENAME_TOTAL_CAP = 80;
const TITLE_WORDS_LIMIT = 5;

function slugifyWords(input: string, maxWords: number): string {
  // Stop words stay (predictability over cleverness, per spec).
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join("-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function shortHash(input: string, hexChars: number): string {
  // Tiny non-cryptographic hash. Deterministic per (postId, imageIndex)
  // → re-publishing the same image upload overwrites the same file.
  // FNV-1a 32-bit, hex, truncated.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, hexChars);
}

function pickExtension(originalFilename: string | null | undefined): string {
  if (!originalFilename) return "jpg";
  const dot = originalFilename.lastIndexOf(".");
  if (dot < 0 || dot >= originalFilename.length - 1) return "jpg";
  const ext = originalFilename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return ext || "jpg";
}

/**
 * Generate a collision-resistant SEO-friendly image filename.
 *
 * @param postTitle Source for the human-readable slug. First N words.
 * @param originalFilename Source for the file extension (default `.jpg`).
 * @param imageIndex 0 = featured. Subsequent images get `-${imageIndex+1}`.
 * @param postId Optional. When present, drives the deterministic 4-char
 *   hash suffix. Without it the suffix derives from postTitle alone —
 *   weaker collision-resistance but still deterministic.
 */
export function generateImageFilename(
  postTitle: string,
  originalFilename: string | null | undefined,
  imageIndex: number = 0,
  postId?: string,
): string {
  const slug = slugifyWords(postTitle || "image", TITLE_WORDS_LIMIT) || "image";
  const ext = pickExtension(originalFilename);
  const indexSuffix = imageIndex > 0 ? `-${imageIndex + 1}` : "";
  const hash = shortHash(`${postId ?? slug}::${imageIndex}`, 4);

  let stem = `${slug}${indexSuffix}-${hash}`;
  // Total cap including extension + dot. Leave the hash intact —
  // collision-resistance is more important than the slug's last word.
  const maxStemLen = FILENAME_TOTAL_CAP - (ext.length + 1);
  if (stem.length > maxStemLen) {
    // Trim the slug part, keep the index + hash suffix.
    const keepSuffix = `${indexSuffix}-${hash}`;
    const trimmedSlug = slug.slice(0, Math.max(1, maxStemLen - keepSuffix.length));
    stem = `${trimmedSlug.replace(/-+$/, "")}${keepSuffix}`;
  }
  return `${stem}.${ext}`;
}
