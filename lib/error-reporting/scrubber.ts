// ---------------------------------------------------------------------------
// PII / secret scrubber — runs on the client before send AND on the server
// before persistence and mail. Defence in depth.
//
// Rules applied:
//   1. Keys matching SENSITIVE_KEY_RE → value replaced with "[redacted]"
//   2. JWT tokens in string values → replaced with "[jwt-redacted]"
//   3. Credit-card-shaped digit runs (Luhn-valid, 13–19 digits) → "[card-redacted]"
//   4. Email addresses inside free-form text → "[email-redacted]"
//      (identity block emails are kept — scrubbing is for breadcrumb text)
//
// Form field VALUES are never collected at the breadcrumb layer, so they
// never reach this scrubber. The scrubber is belt-and-braces for nested
// state slices and URL query params.
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_RE = /password|token|secret|api[_-]?key|authorization|cookie/i;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// Matches 13–19 consecutive digits (card-shaped). Luhn check applied below.
const CARD_DIGIT_RE = /\b\d{13,19}\b/g;

function luhnValid(s: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = parseInt(s[i]!, 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function scrubString(value: string): string {
  return value
    .replace(JWT_RE, "[jwt-redacted]")
    .replace(CARD_DIGIT_RE, (match) => (luhnValid(match) ? "[card-redacted]" : match))
    .replace(EMAIL_RE, "[email-redacted]");
}

function scrubValue(value: unknown, key?: string, depth = 0): unknown {
  if (depth > 6) return "[truncated]";

  if (key && SENSITIVE_KEY_RE.test(key)) return "[redacted]";

  if (typeof value === "string") return scrubString(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => scrubValue(v, undefined, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v, k, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Scrub a full ErrorReport payload (or any nested object) in-place clone.
 * Returns a new object — does not mutate the input.
 */
export function scrubPayload<T>(payload: T): T {
  return scrubValue(payload) as T;
}

/**
 * Scrub a URL string — removes sensitive query param values.
 */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url, "http://localhost");
    for (const [key] of u.searchParams.entries()) {
      if (SENSITIVE_KEY_RE.test(key)) {
        u.searchParams.set(key, "[redacted]");
      }
    }
    // Rebuild without the fake origin for relative URLs
    return url.startsWith("http") ? u.toString() : u.pathname + u.search + u.hash;
  } catch {
    return scrubString(url);
  }
}
