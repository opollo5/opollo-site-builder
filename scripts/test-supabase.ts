// Standalone diagnostic for Week 2 Stage 1a.
// Run via: npx tsx scripts/test-supabase.ts
//
// Requires .env.local with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// OPOLLO_MASTER_KEY to be populated. Loads .env.local manually since tsx
// does not auto-load it (Next.js does, but this script runs outside Next).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decrypt, encrypt } from "../lib/encryption";
import { getServiceRoleClient } from "../lib/supabase";

function loadEnvLocal() {
  try {
    const contents = readFileSync(
      join(process.cwd(), ".env.local"),
      "utf-8",
    );
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env.local — rely on whatever is already in process.env.
  }
}

async function main() {
  loadEnvLocal();

  console.log("=== Supabase connectivity ===");
  const supabase = getServiceRoleClient();
  const { count, error } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("FAIL: query error:", error);
    process.exit(1);
  }
  console.log(`PASS: connected; sites row count = ${count ?? 0}`);

  console.log("\n=== Encryption round-trip ===");
  const plaintext = "test-secret-" + Math.random().toString(36).slice(2);
  const enc = encrypt(plaintext);
  console.log(
    `  plaintext=${plaintext.length}ch  ciphertext=${enc.ciphertext.length}B  iv=${enc.iv.length}B  keyVersion=${enc.keyVersion}`,
  );
  const decrypted = decrypt(enc.ciphertext, enc.iv, enc.keyVersion);
  if (decrypted !== plaintext) {
    console.error(
      `FAIL: round-trip mismatch\n  expected: ${plaintext}\n  got:      ${decrypted}`,
    );
    process.exit(1);
  }
  console.log("PASS: plaintext matches after round-trip");

  console.log("\n=== Tamper detection ===");
  const tampered = Buffer.from(enc.ciphertext);
  tampered[0] ^= 0xff;
  try {
    decrypt(tampered, enc.iv, enc.keyVersion);
    console.error("FAIL: tampered ciphertext decrypted without error");
    process.exit(1);
  } catch {
    console.log("PASS: GCM auth tag rejected tampered ciphertext");
  }

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
