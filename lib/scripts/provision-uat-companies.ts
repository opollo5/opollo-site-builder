/**
 * provision-uat-companies.ts
 *
 * Run:  DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config lib/scripts/provision-uat-companies.ts
 *
 * Idempotent — safe to re-run. Inserts the four V1 UAT customer companies into
 * platform_companies if they don't already exist (matched by slug).
 * Prints the UUID of each company on completion for use in invitation scripts.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!svcUrl || !svcKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const svc = createClient(svcUrl, svcKey, {
  auth: { persistSession: false },
});

const UAT_COMPANIES = [
  { name: "Vincovi",     slug: "vincovi",     domain: null, timezone: "Australia/Melbourne" },
  { name: "ASCII Group", slug: "ascii-group",  domain: null, timezone: "Australia/Melbourne" },
  { name: "Skyview",     slug: "skyview",      domain: null, timezone: "Australia/Melbourne" },
  { name: "Planet6",     slug: "planet6",      domain: null, timezone: "Australia/Melbourne" },
] as const;

async function main() {
  console.log("\n=== PROVISION V1 UAT COMPANIES ===");
  console.log(`Run at: ${new Date().toISOString()}\n`);

  for (const company of UAT_COMPANIES) {
    const { data: existing, error: fetchErr } = await svc
      .from("platform_companies")
      .select("id, name, slug")
      .eq("slug", company.slug)
      .maybeSingle();

    if (fetchErr) {
      console.error(`Failed to query ${company.slug}:`, fetchErr.message);
      process.exit(1);
    }

    if (existing) {
      console.log(`✓ ${company.name.padEnd(14)} already exists  id=${existing.id}`);
      continue;
    }

    const { data: inserted, error: insertErr } = await svc
      .from("platform_companies")
      .insert({
        name: company.name,
        slug: company.slug,
        domain: company.domain,
        timezone: company.timezone,
        is_opollo_internal: false,
      })
      .select("id, name, slug")
      .single();

    if (insertErr) {
      console.error(`Insert failed for ${company.name}:`, insertErr.message);
      process.exit(1);
    }

    console.log(`✓ ${company.name.padEnd(14)} created         id=${inserted.id}`);
  }

  console.log("\nAll UAT companies provisioned. Copy the IDs above for invitation scripts.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
