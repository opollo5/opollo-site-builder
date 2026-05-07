/**
 * migrate-orphaned-assets.ts
 *
 * Run (dry run):  DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config lib/scripts/migrate-orphaned-assets.ts
 * Run (apply):    DOTENV_CONFIG_PATH=.env.local DRY_RUN=false npx tsx -r dotenv/config lib/scripts/migrate-orphaned-assets.ts
 *
 * Assigns all NULL company_id rows in company-scoped social tables to the
 * Opollo Internal company. As of 2026-05, all social tables enforce
 * company_id NOT NULL, so this script finds zero records and completes cleanly.
 *
 * The script is kept for auditing purposes and future recovery if a NOT NULL
 * constraint is ever removed or a migration accidentally allows NULLs.
 *
 * Rollback instructions:
 *   If orphaned rows were incorrectly assigned, revert via:
 *     UPDATE <table> SET company_id = NULL WHERE company_id = '<opollo_internal_id>'
 *       AND id IN (<ids from platform_data_migrations.notes>);
 *   NOTE: this requires temporarily dropping the NOT NULL constraint.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.env.DRY_RUN !== "false";

const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!svcUrl || !svcKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const svc = createClient(svcUrl, svcKey, {
  auth: { persistSession: false },
});

const COMPANY_SCOPED_TABLES: Array<{ table: string }> = [
  { table: "social_connections" },
  { table: "social_post_master" },
  { table: "social_media_assets" },
  { table: "social_approval_requests" },
  { table: "social_viewer_links" },
  { table: "social_connection_alerts" },
  { table: "social_publish_jobs" },
];

const MIGRATION_NAME = "migrate-orphaned-assets";

async function findOpolloInternalId(): Promise<string> {
  const { data, error } = await svc
    .from("platform_companies")
    .select("id")
    .eq("is_opollo_internal", true)
    .maybeSingle();
  if (error) throw new Error(`Cannot find Opollo Internal company: ${error.message}`);
  if (!data) throw new Error("Opollo Internal company not found. Run ensure-opollo-internal-company.ts first.");
  return data.id as string;
}

type TableResult = {
  table: string;
  orphaned: number;
  updated: number;
  sampleIds: string[];
};

async function processTable(
  tableName: string,
  opolloId: string,
): Promise<TableResult> {
  // Find orphaned IDs (first 5 for sample)
  const { data: sampleData, error: sampleErr, count } = await svc
    .from(tableName)
    .select("id", { count: "exact" })
    .is("company_id", null)
    .limit(5);

  if (sampleErr) throw new Error(`Query ${tableName}: ${sampleErr.message}`);

  const orphaned = count ?? 0;
  const sampleIds = (sampleData ?? []).map((r) => r.id as string);

  if (orphaned === 0) {
    return { table: tableName, orphaned: 0, updated: 0, sampleIds: [] };
  }

  if (DRY_RUN) {
    return { table: tableName, orphaned, updated: 0, sampleIds };
  }

  // Apply: UPDATE WHERE company_id IS NULL
  const { error: updateErr, count: updateCount } = await svc
    .from(tableName)
    .update({ company_id: opolloId })
    .is("company_id", null)
    .select("id");

  if (updateErr) throw new Error(`Update ${tableName}: ${updateErr.message}`);

  return { table: tableName, orphaned, updated: updateCount ?? 0, sampleIds };
}

async function logAuditTrail(results: TableResult[], opolloId: string): Promise<void> {
  for (const r of results) {
    if (r.updated === 0) continue;
    const { error } = await svc.from("platform_data_migrations").insert({
      migration_name: MIGRATION_NAME,
      table_name: r.table,
      records_affected: r.updated,
      executed_by: null,
      notes: {
        opollo_internal_id: opolloId,
        sample_ids: r.sampleIds,
        dry_run: false,
      },
    });
    if (error) {
      console.warn(`Warning: audit trail insert for ${r.table} failed: ${error.message}`);
    }
  }
}

async function main() {
  console.log("\n=== MIGRATE ORPHANED ASSETS ===");
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Mode:   ${DRY_RUN ? "DRY RUN (pass DRY_RUN=false to apply)" : "APPLY"}\n`);

  const opolloId = await findOpolloInternalId();
  console.log(`Opollo Internal company ID: ${opolloId}\n`);

  const results: TableResult[] = [];

  for (const { table } of COMPANY_SCOPED_TABLES) {
    const result = await processTable(table, opolloId);
    results.push(result);

    const status = result.orphaned === 0
      ? "✓ no orphans"
      : DRY_RUN
        ? `⚠ ${result.orphaned} orphan(s) found (not applied)`
        : `✓ ${result.updated} row(s) updated`;

    console.log(`  ${table.padEnd(32)} ${status}`);
    if (result.sampleIds.length > 0) {
      console.log(`    sample IDs: ${result.sampleIds.join(", ")}`);
    }
  }

  const totalOrphaned = results.reduce((s, r) => s + r.orphaned, 0);
  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);

  console.log("\n--- Summary ---");
  if (totalOrphaned === 0) {
    console.log("✓ No orphaned assets found. Database is clean.");
  } else if (DRY_RUN) {
    console.log(`⚠ ${totalOrphaned} orphaned row(s) found. Re-run with DRY_RUN=false to apply.`);
  } else {
    await logAuditTrail(results, opolloId);
    console.log(`✓ ${totalUpdated} row(s) assigned to Opollo Internal company.`);
    console.log(`  Audit trail written to platform_data_migrations.`);
  }

  process.exit(totalOrphaned > 0 && DRY_RUN ? 1 : 0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
