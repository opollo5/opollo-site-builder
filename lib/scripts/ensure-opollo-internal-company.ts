/**
 * ensure-opollo-internal-company.ts
 *
 * Run with:  DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config lib/scripts/ensure-opollo-internal-company.ts
 *
 * Verifies the Opollo Internal company exists in platform_companies.
 * If missing, inserts it with the well-known fixed UUID seeded in
 * 0070_platform_foundation.sql.
 *
 * This is a no-op in all real environments — the migration seed handles it.
 * Run this only if you need to recover a wiped dev/staging database.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const OPOLLO_INTERNAL_ID = "00000000-0000-0000-0000-000000000001";

const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!svcUrl || !svcKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const svc = createClient(svcUrl, svcKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("\n=== ENSURE OPOLLO INTERNAL COMPANY ===");
  console.log(`Run at: ${new Date().toISOString()}\n`);

  const { data: existing, error: fetchErr } = await svc
    .from("platform_companies")
    .select("id, name, slug, is_opollo_internal")
    .eq("is_opollo_internal", true)
    .maybeSingle();

  if (fetchErr) {
    console.error("Failed to query platform_companies:", fetchErr.message);
    process.exit(1);
  }

  if (existing) {
    console.log(`✓ Opollo Internal company already exists.`);
    console.log(`  id:   ${existing.id}`);
    console.log(`  name: ${existing.name}`);
    console.log(`  slug: ${existing.slug}`);
    process.exit(0);
  }

  console.log("Opollo Internal company not found — inserting...");

  const { data: inserted, error: insertErr } = await svc
    .from("platform_companies")
    .insert({
      id: OPOLLO_INTERNAL_ID,
      name: "Opollo",
      slug: "opollo",
      is_opollo_internal: true,
      timezone: "Australia/Melbourne",
    })
    .select("id, name, slug")
    .single();

  if (insertErr) {
    console.error("Insert failed:", insertErr.message);
    process.exit(1);
  }

  console.log(`✓ Created Opollo Internal company.`);
  console.log(`  id:   ${inserted.id}`);
  console.log(`  name: ${inserted.name}`);
  console.log(`  slug: ${inserted.slug}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
