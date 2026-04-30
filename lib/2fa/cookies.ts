import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P4.1 — signed device_id cookie helpers.
//
// device_id is the second half of the trust-matching tuple (the first
// half is user_id from the Supabase session). It's persisted as a
// signed cookie:
//
//   Name:     opollo_device_id
//   Value:    <uuid>.<hmac-sha256-base64url>
//   HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=30 days
//
// Signing key: COOKIE_SIGNING_SECRET env var (32-byte hex, set in P1).
//
// Why HMAC instead of just storing the uuid:
//   - A bare uuid cookie is forgeable by anyone who can guess it.
//     The HMAC binds the value to a server-side secret so an attacker
//     can't fabricate device_id values, only replay a value they
//     already control.
//   - Even if device_id leaks, trust still requires the user_id to
//     match the Supabase session — so the leak alone doesn't grant
//     access without also stealing the session cookie.
//
// On sign-out: clear the session cookie but KEEP device_id (per the
// brief — next sign-in matches the trusted device). On
// "sign out this device": clear both AND mark trusted_devices row
// revoked.
// ---------------------------------------------------------------------------

export const DEVICE_ID_COOKIE = "opollo_device_id";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function getCookieMaxAgeSeconds(): number {
  return COOKIE_MAX_AGE_SECONDS;
}

function loadSigningSecret(): Buffer {
  const raw = process.env.COOKIE_SIGNING_SECRET;
  if (!raw) {
    throw new Error(
      "COOKIE_SIGNING_SECRET is not set. Generate via `openssl rand -hex 32` and add to Vercel env vars.",
    );
  }
  // Accept either hex (32 bytes = 64 chars) or any non-empty string.
  // Hex is the canonical shape per the P1 brief; non-hex still works
  // since HMAC takes any byte sequence as a key.
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return Buffer.from(raw, "utf8");
}

function sign(value: string): string {
  const key = loadSigningSecret();
  return createHmac("sha256", key).update(value).digest("base64url");
}

/** Build the cookie value for a given device_id (uuid). */
export function encodeDeviceCookie(deviceId: string): string {
  return `${deviceId}.${sign(deviceId)}`;
}

/** Validate the cookie value and return the device_id if valid, else null. */
export function decodeDeviceCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [deviceId, signature] = parts;
  if (!deviceId || !signature) return null;
  const expected = sign(deviceId);
  // timingSafeEqual requires equal-length buffers; bail on mismatch
  // BEFORE calling it to avoid the synchronous throw that would
  // otherwise leak the comparison size.
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Constant-time false: feed a same-length filler through the
    // comparator so timing doesn't depend on value length.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return null;
  }
  if (!timingSafeEqual(a, b)) return null;
  // Sanity-check the deviceId shape — UUID-ish.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return null;
  }
  return deviceId;
}

export function isCookieSigningSecretSet(): boolean {
  const raw = process.env.COOKIE_SIGNING_SECRET;
  return Boolean(raw && raw.length > 0);
}

// ---------------------------------------------------------------------------
// IP hashing for ip_hash columns. Uses IP_HASH_PEPPER (per P1) so the
// raw IP isn't recoverable from the stored hash.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const pepper = process.env.IP_HASH_PEPPER;
  if (!pepper) {
    // No pepper → return the unsalted hash. Less ideal but still
    // doesn't store the raw IP. P1 requires the pepper, so this
    // branch only fires in misconfigured environments.
    return createHash("sha256").update(ip).digest("hex");
  }
  return createHash("sha256")
    .update(`${pepper}:${ip}`)
    .digest("hex");
}
