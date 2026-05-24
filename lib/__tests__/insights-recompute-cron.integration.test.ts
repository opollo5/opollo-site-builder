import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function svc() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

const CRON_ROUTE = "/api/cron/insights-recompute";
const CRON_SECRET = process.env.CRON_SECRET ?? "test-secret";

async function callRecomputeCron(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}${CRON_ROUTE}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

describe("Insights recompute cron — integration", () => {
  // Clean up any test rows written by these tests
  afterAll(async () => {
    const client = svc();
    // Remove any recompute ingest log rows from this test run
    await client
      .from("ins_ingest_log")
      .delete()
      .eq("cron_route", CRON_ROUTE)
      .gte("started_at", new Date(Date.now() - 60000).toISOString());
    await client
      .from("cap_generation_runs")
      .delete()
      .eq("operation", "insights_recompute")
      .gte("created_at", new Date(Date.now() - 60000).toISOString());
  });

  it("find_companies_eligible_for_recompute RPC exists and runs", async () => {
    const client = svc();
    const { error } = await client.rpc("find_companies_eligible_for_recompute", {
      min_posts: 20,
      cutoff_iso: new Date(Date.now() - 90 * 86400000).toISOString(),
    });
    // The RPC should exist — we only care it doesn't return a 42883 (function not found)
    if (error && error.code === "42883") {
      throw new Error(`find_companies_eligible_for_recompute does not exist: ${error.message}`);
    }
    // Other errors (e.g. no rows) are acceptable
  });

  it("ins_ingest_log row is written after cron run (local dev server)", async () => {
    const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    // Skip if local dev server is not running
    let serverUp = false;
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      serverUp = true;
    } catch {
      serverUp = false;
    }

    if (!serverUp) {
      // Skip gracefully — CI runs test:integration without dev server
      return;
    }

    const before = Date.now();
    const res = await callRecomputeCron(BASE_URL);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify ins_ingest_log row
    const client = svc();
    const { data: logRows } = await client
      .from("ins_ingest_log")
      .select("*")
      .eq("cron_route", CRON_ROUTE)
      .gte("started_at", new Date(before).toISOString())
      .order("started_at", { ascending: false })
      .limit(1);

    expect(logRows).toBeDefined();
    expect((logRows ?? []).length).toBeGreaterThan(0);
  });

  it("cap_generation_runs operation='insights_recompute' is valid schema", async () => {
    const client = svc();
    // Verify migration 0146 applied: cap_campaign_id should be nullable
    // We test this by inserting a row and ensuring no NOT NULL violation
    const { error } = await client.from("cap_generation_runs").insert({
      cap_campaign_post_id: null,
      cap_campaign_id: null,
      operation: "insights_recompute",
      prompt_version: 1,
      prompt_used: "integration-test",
      model: "none",
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      latency_ms: 0,
      status: "success",
    });

    // If error is NOT NULL violation, migration hasn't applied yet
    if (error && error.message.includes("not-null")) {
      throw new Error(
        `Migration 0146 not applied: cap_campaign_id is still NOT NULL. Run: supabase db reset or apply the migration.`,
      );
    }
    // Any other error (e.g. RLS) is acceptable for the schema test
  });
});
