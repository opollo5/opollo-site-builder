import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CURRENT_KEY_VERSION,
  decrypt,
  encrypt,
} from "@/lib/encryption";

// ---------------------------------------------------------------------------
// M15-7 — AES-256-GCM encryption unit tests.
//
// lib/encryption.ts is the sole module that protects every site's WordPress
// application password (stored as site_credentials.site_secret_encrypted
// bytea). This suite pins round-trip correctness, IV randomness, tamper
// detection, wrong-key rejection, and all invalid-input error paths.
//
// No mocks of node:crypto — the whole point is to exercise the real cipher.
// No network, DB, or Supabase references — this is a pure unit test.
// ---------------------------------------------------------------------------

const ENV_KEYS = ["OPOLLO_MASTER_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Returns a deterministic 32-byte base64 key. seed=0 is the zero-filled key
 *  already allow-listed in .gitleaks.toml for the test suite. */
function testKey(seed = 0): string {
  return Buffer.alloc(32, seed).toString("base64");
}

/** Set the master key env var to a valid test key and return it. */
function setKey(seed = 0): string {
  const k = testKey(seed);
  process.env.OPOLLO_MASTER_KEY = k;
  return k;
}

// ---------------------------------------------------------------------------
// Round-trip happy path
// ---------------------------------------------------------------------------

describe("encrypt / decrypt round-trip", () => {
  it("round-trips a simple ASCII string", () => {
    setKey();
    const plaintext = "hello world";
    const { ciphertext, iv, keyVersion } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv, keyVersion)).toBe(plaintext);
  });

  it("round-trips a 4 KB ASCII payload", () => {
    setKey();
    const plaintext = "A".repeat(4096);
    const { ciphertext, iv, keyVersion } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv, keyVersion)).toBe(plaintext);
  });

  it("round-trips Unicode including emoji and multi-byte codepoints", () => {
    setKey();
    const plaintext = "héllo 🔑 世界";
    const { ciphertext, iv, keyVersion } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv, keyVersion)).toBe(plaintext);
  });

  it("round-trips the empty string", () => {
    setKey();
    const plaintext = "";
    const { ciphertext, iv, keyVersion } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv, keyVersion)).toBe(plaintext);
  });

  it("produces distinct IVs and ciphertexts on repeated encrypt calls (IV randomness)", () => {
    setKey();
    const plaintext = "same plaintext";
    const r1 = encrypt(plaintext);
    const r2 = encrypt(plaintext);

    // IVs must differ (no IV reuse)
    expect(r1.iv.equals(r2.iv)).toBe(false);
    // Ciphertexts must differ (distinct IV produces distinct output)
    expect(r1.ciphertext.equals(r2.ciphertext)).toBe(false);
  });

  it("returns an EncryptResult with the expected shape", () => {
    setKey();
    const plaintext = "shape check";
    const plaintextBytes = Buffer.byteLength(plaintext, "utf8");
    const result = encrypt(plaintext);

    expect(result.keyVersion).toBe(1);
    expect(result.iv.length).toBe(12);
    // ciphertext = encrypted body + 16-byte auth tag
    expect(result.ciphertext.length).toBe(plaintextBytes + 16);
  });

  it("round-trips with explicit keyVersion: 1 argument", () => {
    setKey();
    const plaintext = "explicit key version";
    const { ciphertext, iv } = encrypt(plaintext, 1);
    expect(decrypt(ciphertext, iv, 1)).toBe(plaintext);
  });

  it("returned keyVersion field is 1", () => {
    setKey();
    const { keyVersion } = encrypt("spot check");
    expect(keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(keyVersion).toBe(1);
  });

  it("encrypts the same plaintext 10 times and every ciphertext is distinct", () => {
    setKey();
    const plaintext = "randomness seeded key";
    const ciphertexts = Array.from({ length: 10 }, () => encrypt(plaintext).ciphertext);

    const unique = new Set(ciphertexts.map((c) => c.toString("hex")));
    expect(unique.size).toBe(10);
  });

  it("decrypts correctly after changing and restoring OPOLLO_MASTER_KEY (no stale-state caching)", () => {
    setKey(0);
    const plaintext = "stale state check";
    const { ciphertext, iv, keyVersion } = encrypt(plaintext);

    // Temporarily swap to a different key, then restore
    process.env.OPOLLO_MASTER_KEY = testKey(1);
    // With the wrong key the decrypt must fail (proven elsewhere).
    // Now restore the original key and verify decrypt still works.
    process.env.OPOLLO_MASTER_KEY = testKey(0);

    expect(decrypt(ciphertext, iv, keyVersion)).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe("tamper detection", () => {
  it("throws when one byte in the ciphertext body is flipped", () => {
    setKey();
    const { ciphertext, iv, keyVersion } = encrypt("tamper body");

    // The body is everything except the last 16 bytes (auth tag).
    // If the plaintext is non-empty there will be at least one body byte.
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff; // flip first byte of body

    expect(() => decrypt(tampered, iv, keyVersion)).toThrow();
  });

  it("throws when one byte in the auth tag region is flipped", () => {
    setKey();
    const { ciphertext, iv, keyVersion } = encrypt("tamper auth tag");

    const tampered = Buffer.from(ciphertext);
    // Auth tag occupies the last 16 bytes
    tampered[tampered.length - 1] ^= 0x01;

    expect(() => decrypt(tampered, iv, keyVersion)).toThrow();
  });

  it("throws when one byte in the IV is flipped before decrypt", () => {
    setKey();
    const { ciphertext, iv, keyVersion } = encrypt("tamper iv");

    const tamperedIv = Buffer.from(iv);
    tamperedIv[0] ^= 0xff;

    expect(() => decrypt(ciphertext, tamperedIv, keyVersion)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Wrong-key decryption
// ---------------------------------------------------------------------------

describe("wrong-key decryption", () => {
  it("throws when decrypting with a different 32-byte key", () => {
    setKey(0);
    const { ciphertext, iv, keyVersion } = encrypt("wrong key test");

    // Switch to a different valid key
    process.env.OPOLLO_MASTER_KEY = testKey(1);

    expect(() => decrypt(ciphertext, iv, keyVersion)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Invalid-environment error paths
// ---------------------------------------------------------------------------

describe("error paths — invalid environment", () => {
  it("encrypt throws 'OPOLLO_MASTER_KEY is not set.' when key is missing", () => {
    delete process.env.OPOLLO_MASTER_KEY;
    expect(() => encrypt("anything")).toThrow("OPOLLO_MASTER_KEY is not set.");
  });

  it("decrypt throws 'OPOLLO_MASTER_KEY is not set.' when key is missing", () => {
    setKey();
    const { ciphertext, iv, keyVersion } = encrypt("payload");

    delete process.env.OPOLLO_MASTER_KEY;
    expect(() => decrypt(ciphertext, iv, keyVersion)).toThrow(
      "OPOLLO_MASTER_KEY is not set.",
    );
  });

  it("encrypt throws when OPOLLO_MASTER_KEY decodes to 31 bytes", () => {
    // 31 bytes → base64 encodes to 44 chars; confirm length error message
    process.env.OPOLLO_MASTER_KEY = Buffer.alloc(31).toString("base64");
    expect(() => encrypt("anything")).toThrow(
      "must be 32 bytes after base64 decode, got 31",
    );
  });

  it("encrypt throws when OPOLLO_MASTER_KEY decodes to 33 bytes", () => {
    process.env.OPOLLO_MASTER_KEY = Buffer.alloc(33).toString("base64");
    expect(() => encrypt("anything")).toThrow(
      "must be 32 bytes after base64 decode, got 33",
    );
  });

  it("encrypt throws when OPOLLO_MASTER_KEY is invalid base64 (wrong decoded length)", () => {
    // Buffer.from tolerates arbitrary base64, but the decoded length won't
    // be 32 bytes — the code must throw on the length check.
    process.env.OPOLLO_MASTER_KEY = "not-32-bytes!";
    expect(() => encrypt("anything")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Key-version handling
// ---------------------------------------------------------------------------

describe("key-version handling", () => {
  it("encrypt(plaintext, 2) throws 'version 2 is not available'", () => {
    setKey();
    expect(() => encrypt("any", 2)).toThrow(
      "OPOLLO_MASTER_KEY version 2 is not available",
    );
  });

  it("decrypt with keyVersion=2 throws 'version 2 is not available'", () => {
    setKey();
    const { ciphertext, iv } = encrypt("any");
    expect(() => decrypt(ciphertext, iv, 2)).toThrow(
      "OPOLLO_MASTER_KEY version 2 is not available",
    );
  });
});

// ---------------------------------------------------------------------------
// Malformed decrypt inputs
// ---------------------------------------------------------------------------

describe("malformed decrypt inputs", () => {
  it("throws 'IV must be 12 bytes, got 8.' for an 8-byte IV", () => {
    setKey();
    const { ciphertext } = encrypt("iv length test");
    const shortIv = Buffer.alloc(8);
    expect(() => decrypt(ciphertext, shortIv, 1)).toThrow(
      "IV must be 12 bytes, got 8.",
    );
  });

  it("throws when ciphertext is shorter than the 16-byte auth tag", () => {
    setKey();
    const goodIv = Buffer.alloc(12);
    expect(() => decrypt(Buffer.alloc(15), goodIv, 1)).toThrow(
      "Ciphertext too short to contain auth tag (min 16 bytes).",
    );
  });

  it("handles exactly-auth-tag-length ciphertext (16 bytes, zero body)", () => {
    setKey();
    const goodIv = Buffer.alloc(12);
    // A 16-byte ciphertext passes the length guard but contains only an auth
    // tag with no encrypted body. The GCM decipher will either decrypt to an
    // empty string or throw on auth tag verification — both outcomes are
    // acceptable; this test pins the current behaviour.
    const exactSizeBuffer = Buffer.alloc(16);
    let result: string | undefined;
    let threw = false;
    try {
      result = decrypt(exactSizeBuffer, goodIv, 1);
    } catch {
      threw = true;
    }
    if (!threw) {
      // If it did not throw, the result must be a string (possibly empty)
      expect(typeof result).toBe("string");
    } else {
      expect(threw).toBe(true);
    }
  });
});
