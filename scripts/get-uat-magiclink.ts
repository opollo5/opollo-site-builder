#!/usr/bin/env -S npx tsx
// scripts/get-uat-magiclink.ts
//
// Generates a Supabase magic link for the UAT ghost user on staging.
// Magic links bypass the password flow entirely — no 2FA challenge fires.
//
// Usage:
//   set -a && source .env.staging.local && set +a
//   npx tsx scripts/get-uat-magiclink.ts

import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "bjiiqnetaxoibhcaukqm";
const UAT_EMAIL = "uat-bot@staging.opollo.com";
const STAGING_BASE_URL = "https://opollo-site-builder-git-staging-opollo5.vercel.app";
const REDIRECT_PATH = "/company/social/calendar?compose=2c5036f2-91f8-46fd-ab00-fb3561194b72";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url) {
  console.error("[MAGICLINK FAIL] SUPABASE_URL is not set.");
  process.exit(1);
}
if (!url.includes(STAGING_PROJECT_REF)) {
  console.error(`[MAGICLINK FAIL] Refusing — SUPABASE_URL does not contain staging ref '${STAGING_PROJECT_REF}'. Got: ${url}`);
  process.exit(1);
}
if (!key) {
  console.error("[MAGICLINK FAIL] SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Build the app-callback URL directly from the hashed_token so we never
// depend on Supabase's redirect allow-list or site URL config.
// The app's /api/auth/callback handler accepts ?token_hash=&type= (OTP shape).
function buildCallbackUrl(hashedToken: string, type: string): string {
  const next = encodeURIComponent(REDIRECT_PATH);
  return `${STAGING_BASE_URL}/api/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(type)}&next=${next}`;
}

async function main() {
  // Try magic link first
  console.log(`[MAGICLINK] Generating magic link for ${UAT_EMAIL}...`);
  const { data: mlData, error: mlError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: UAT_EMAIL,
  });

  if (!mlError && mlData?.properties?.hashed_token) {
    const link = buildCallbackUrl(mlData.properties.hashed_token, "magiclink");
    console.log("\n✓ Magic link generated (expires ~1 hour):");
    console.log("\n" + link + "\n");
    return;
  }

  if (mlError) {
    console.warn(`[MAGICLINK WARN] generateLink(magiclink) failed: ${mlError.message}`);
    console.log("[MAGICLINK] Falling back to recovery link...");
  }

  // Fallback: recovery link
  const { data: recData, error: recError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: UAT_EMAIL,
  });

  if (recError || !recData?.properties?.hashed_token) {
    console.error(`[MAGICLINK FAIL] Recovery link also failed: ${recError?.message ?? "no hashed_token returned"}`);
    process.exit(1);
  }

  const link = buildCallbackUrl(recData.properties.hashed_token, "recovery");
  console.log("\n✓ Recovery link generated (Steven: follow it and set the same password to log in):");
  console.log("\n" + link + "\n");
}

main().catch((err: unknown) => {
  console.error("[MAGICLINK FATAL]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
