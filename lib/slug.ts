// Yoast-style slug generator.
//
// Eight-step algorithm matching Yoast SEO's slugification:
//   1. Trim + lowercase
//   2. Strip Unicode diacritics (NFKD decompose → remove combining marks)
//   3. Remove stop words at word boundaries
//   4. Collapse remaining whitespace
//   5. Replace non-alphanumeric runs with hyphens
//   6. Remove leading/trailing hyphens
//   7. Collapse consecutive hyphens
//   8. Truncate at 60 chars without mid-word split (back off to last hyphen ≤60)

export const SLUG_STOP_WORDS = new Set([
  "a", "an", "the",
  "and", "but", "or", "nor", "for", "yet", "so",
  "at", "by", "from", "in", "into", "of", "off",
  "on", "onto", "out", "over", "to", "up", "with",
  "about", "above", "after", "as", "before", "between",
  "during", "except", "like", "near", "since", "than",
  "through", "under", "until", "upon", "while",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "shall", "should", "may", "might",
  "must", "can", "could",
  "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your",
  "he", "him", "his", "she", "her", "it", "its",
  "they", "them", "their",
  "what", "which", "who", "whom", "whose",
  "not", "no",
]);

const TRUNCATE_AT = 60;

export function generateSlug(raw: string): string {
  // 1. Trim + lowercase
  let s = raw.trim().toLowerCase();

  // 2. Strip diacritics via Unicode NFKD decomposition
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

  // 3. Remove stop words at word boundaries (only when the result won't
  //    leave an empty string — keep at least one word).
  const words = s.split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !SLUG_STOP_WORDS.has(w));
  if (meaningful.length > 0) {
    s = meaningful.join(" ");
  } else {
    s = words.join(" ");
  }

  // 4. Replace non-alphanumeric runs with hyphens
  s = s.replace(/[^a-z0-9]+/g, "-");

  // 5. Remove leading/trailing hyphens
  s = s.replace(/^-+|-+$/g, "");

  // 6. Collapse consecutive hyphens
  s = s.replace(/-{2,}/g, "-");

  // 7. Truncate at 60 chars without splitting a word
  if (s.length > TRUNCATE_AT) {
    const cut = s.slice(0, TRUNCATE_AT + 1);
    const lastHyphen = cut.lastIndexOf("-");
    s = lastHyphen > 0 ? s.slice(0, lastHyphen) : s.slice(0, TRUNCATE_AT);
    // Clean any trailing hyphen that truncation may have introduced
    s = s.replace(/-+$/, "");
  }

  return s;
}
