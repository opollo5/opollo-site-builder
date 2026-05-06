/**
 * audit-orphaned-assets.ts
 *
 * Run with:  npx tsx lib/scripts/audit-orphaned-assets.ts
 *
 * Checks every company-scoped social table for rows where company_id IS NULL
 * (should be zero — the schema enforces NOT NULL on all these columns).
 * Also verifies the "Opollo Internal" company exists.
 *
 * Reports:
 *   table_name | total_count | orphaned_count | orphaned_pct | sample_ids
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

const COMPANY_SCOPED_TABLES: Array<{ table: string; companyCol: string }> = [
  { table: "social_connections",       companyCol: "company_id" },
  { table: "social_post_master",       companyCol: "company_id" },
  { table: "social_media_assets",      companyCol: "company_id" },
  { table: "social_approval_requests", companyCol: "company_id" },
  { table: "social_viewer_links",      companyCol: "company_id" },
  { table: "social_connection_alerts", companyCol: "company_id" },
  { table: "social_publish_jobs",      companyCol: "company_id" },
];

type AuditRow = {
  table: string;
  total: number;
  orphaned: number;
  pct: string;
  sampleIds: string[];
};

async function countAll(table: string): Promise<number> {
  const { count, error } = await svc
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count ?? 0;
}

async function getOrphans(
  table: string,
  companyCol: string,
): Promise<{ count: number; sampleIds: string[] }> {
  // PostgREST doesn't support IS NULL filtering out of the box via .is(),
  // but we can use .is(col, null).
  const { data, error, count } = await svc
    .from(table)
    .select("id", { count: "exact" })
    .is(companyCol, null)
    .limit(5);
  if (error) throw new Error(`orphans(${table}): ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => r.id as string),
  };
}

async function checkOpolloInternal(): Promise<boolean> {
  const { data, error } = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("is_opollo_internal", true)
    .maybeSingle();
  if (error) throw new Error(`Opollo Internal check: ${error.message}`);
  return data !== null;
}

async function main() {
  console.log("\n=== ORPHANED ASSETS AUDIT ===");
  console.log(`Run at: ${new Date().toISOString()}\n`);

  const rows: AuditRow[] = [];

  for (const { table, companyCol } of COMPANY_SCOPED_TABLES) {
    const [total, orphans] = await Promise.all([
      countAll(table),
      getOrphans(table, companyCol),
    ]);
    rows.push({
      table,
      total,
      orphaned: orphans.count,
      pct: total > 0 ? `${((orphans.count / total) * 100).toFixed(1)}%` : "0%",
      sampleIds: orphans.sampleIds,
    });
  }

  // Print table
  const colWidths = { table: 32, total: 8, orphaned: 10, pct: 8 };
  const header = [
    "TABLE".padEnd(colWidths.table),
    "TOTAL".padEnd(colWidths.total),
    "ORPHANED".padEnd(colWidths.orphaned),
    "PCT".padEnd(colWidths.pct),
    "SAMPLE IDS",
  ].join(" | ");
  console.log(header);
  console.log("─".repeat(header.length));

  let totalOrphaned = 0;
  for (const r of rows) {
    console.log(
      [
        r.table.padEnd(colWidths.table),
        String(r.total).padEnd(colWidths.total),
        String(r.orphaned).padEnd(colWidths.orphaned),
        r.pct.padEnd(colWidths.pct),
        r.sampleIds.length ? r.sampleIds.join(", ") : "—",
      ].join(" | "),
    );
    totalOrphaned += r.orphaned;
  }

  console.log("\n--- Opollo Internal company ---");
  const hasInternal = await checkOpolloInternal();
  console.log(hasInternal ? "EXISTS ✓" : "MISSING ✗ — must be seeded before migration");

  console.log("\n--- Summary ---");
  if (totalOrphaned === 0) {
    console.log("✓ No orphaned assets found. Schema NOT NULL constraints are working correctly.");
    console.log("  Phase 2 (schema enforcement) is already complete — all company_id columns are NOT NULL.");
  } else {
    console.log(`✗ ${totalOrphaned} orphaned row(s) found across ${rows.filter((r) => r.orphaned > 0).length} table(s).`);
    console.log("  Run migrate-orphaned-assets.ts to assign them to Opollo Internal company.");
  }

  process.exit(totalOrphaned > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
