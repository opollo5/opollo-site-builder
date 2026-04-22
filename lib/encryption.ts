import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// AES-256-GCM: 32-byte key, 12-byte IV (96-bit, recommended), 16-byte auth tag.
// The auth tag is appended to the ciphertext for storage in a single bytea
// column; callers receive { ciphertext, iv, keyVersion } and pass the same
// tuple back to decrypt().
//
// Reference: docs/WEEK2_ARCHITECTURE_v2.md §4.5 (master key + quarterly rotation).

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export const CURRENT_KEY_VERSION = 1;

export type EncryptResult = {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
};

function loadMasterKey(version: number): Buffer {
  // Stage 1a: only version 1 is supported. When we rotate, additional
  // versions will be loaded from env vars like OPOLLO_MASTER_KEY_V2.
  if (version !== 1) {
    throw new Error(
      `OPOLLO_MASTER_KEY version ${version} is not available (only v1 is configured).`,
    );
  }
  const encoded = process.env.OPOLLO_MASTER_KEY;
  if (!encoded) {
    throw new Error("OPOLLO_MASTER_KEY is not set.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `OPOLLO_MASTER_KEY must be ${KEY_BYTES} bytes after base64 decode, got ${key.length}.`,
    );
  }
  return key;
}

export function encrypt(
  plaintext: string,
  keyVersion: number = CURRENT_KEY_VERSION,
): EncryptResult {
  const key = loadMasterKey(keyVersion);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);
  return { ciphertext, iv, keyVersion };
}

export function decrypt(
  ciphertext: Buffer,
  iv: Buffer,
  keyVersion: number = CURRENT_KEY_VERSION,
): string {
  const key = loadMasterKey(keyVersion);
  if (iv.length !== IV_BYTES) {
    throw new Error(
      `IV must be ${IV_BYTES} bytes, got ${iv.length}.`,
    );
  }
  if (ciphertext.length < AUTH_TAG_BYTES) {
    throw new Error(
      `Ciphertext too short to contain auth tag (min ${AUTH_TAG_BYTES} bytes).`,
    );
  }
  const encrypted = ciphertext.subarray(
    0,
    ciphertext.length - AUTH_TAG_BYTES,
  );
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
