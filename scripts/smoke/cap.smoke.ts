#!/usr/bin/env tsx
/**
 * scripts/smoke/cap.smoke.ts
 *
 * Smoke test for the CAP (Content Automation Platform) pipeline.
 * Makes real Anthropic + Ideogram API calls — guarded by $5 budget cap.
 *
 * Required env vars:
 *   SMOKE_BASE_URL            — defaults to https://app.opollo.com
 *   SMOKE_SESSION_COOKIE      — session_token cookie for a cap_operator user
 *   SMOKE_TEST_COMPANY_ID     — UUID of the test company with an active CAP subscription
 *   SMOKE_CAP_CAMPAIGN_ID     — UUID of an existing draft campaign to (re-)generate
 *                               (obtain from the admin CAP campaigns page)
 *
 * Optional:
 *   SMOKE_CAP_SKIP_GENERATION — set to "1" to skip the actual generation step
 *                               (runs auth/shape checks only, costs $0)
 *
 * Usage:
 *   npx tsx scripts/smoke/cap.smoke.ts
 *
 * Output:
 *   scripts/smoke/output/cap-smoke-{timestamp}.json
 *
 * Cost estimate:
 *   ~$0.20-$0.50 per generation run (4 posts × text + optional image per post)
 */

import fs from "node:fs";
import path from "node:path";
import { smokeGet, smokePost, SMOKE_BASE_URL } from "./client";
import { assertStatus, assertShape, assertTruthy } from "./assertions";
import { getTestCompanyId, requireEnv } from "./test-data";
import { guardBudget, recordSpend, getBudgetRemaining } from "./budget";

interface SmokeResult {
  step: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  error?: string;
  data?: unknown;
}

const results: SmokeResult[] = [];

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ step: name, ok: true, durationMs: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: name, ok: false, durationMs: Date.now() - start, error: msg });
    console.error(`  ✗ ${name}: ${msg}`);
  }
}

async function main() {
  const companyId = getTestCompanyId();
  const campaignId = requireEnv("SMOKE_CAP_CAMPAIGN_ID");
  const skipGeneration = process.env.SMOKE_CAP_SKIP_GENERATION === "1";

  console.log(`\nCAP smoke test → ${SMOKE_BASE_URL}`);
  console.log(`  company:    ${companyId}`);
  console.log(`  campaign:   ${campaignId}`);
  console.log(`  budget remaining: $${getBudgetRemaining().toFixed(2)}`);
  if (skipGeneration) console.log("  [SKIP_GENERATION=1 — skipping actual AI generation]");
  console.log("");

  // Step 1: Verify subscription is accessible + has an active status
  await step("GET /api/platform/cap/subscriptions?company_id → 200", async () => {
    const res = await smokeGet(
      `/api/platform/cap/subscriptions?company_id=${encodeURIComponent(companyId)}`,
    );
    assertStatus(res, 200, "get subscription");
    const body = (await res.json()) as { ok: boolean; data: { id: string; status: string; tier: string } | null };
    assertTruthy(body.ok, "response.ok should be true");
    assertTruthy(body.data !== null, "subscription should exist for test company");
    assertShape(body.data as Record<string, unknown>, ["id", "status", "tier"], "subscription shape");
    const validStatuses = ["trial", "active"];
    assertTruthy(
      validStatuses.includes(body.data!.status),
      `subscription status should be trial or active, got ${body.data!.status}`,
    );
  });

  if (skipGeneration) {
    console.log("  (skipped: SMOKE_CAP_SKIP_GENERATION=1)");
  } else {
    // Step 2: Budget guard — estimate $0.50 per run (conservative)
    const ESTIMATED_COST_USD = 0.50;
    await step(`Budget guard ($${ESTIMATED_COST_USD.toFixed(2)} estimated)`, async () => {
      guardBudget(ESTIMATED_COST_USD);
    });

    // Step 3: Trigger generation — real Anthropic + Ideogram calls
    let actualCost = 0;
    await step(
      `POST /api/platform/cap/campaigns/${campaignId}/generate → 200`,
      async () => {
        const res = await smokePost(
          `/api/platform/cap/campaigns/${campaignId}/generate`,
          {},
        );
        assertStatus(res, 200, "generate campaign");
        const body = (await res.json()) as {
          ok: boolean;
          data: { status: string; postsGenerated: number; totalCostUsd?: number };
        };
        assertTruthy(body.ok, "response.ok should be true");
        assertShape(body.data as Record<string, unknown>, ["status", "postsGenerated"], "generation result shape");
        assertTruthy(
          body.data.status === "review",
          `expected campaign status=review after generation, got ${body.data.status}`,
        );
        assertTruthy(
          body.data.postsGenerated === 4,
          `expected 4 posts generated, got ${body.data.postsGenerated}`,
        );
        actualCost = body.data.totalCostUsd ?? ESTIMATED_COST_USD;
      },
    );

    // Step 4: Record actual spend
    await step(`Record spend ($${actualCost.toFixed(4)})`, async () => {
      recordSpend(actualCost, `cap-smoke campaign=${campaignId}`);
    });
  }

  // Write output
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(import.meta.dirname, "output", `cap-smoke-${timestamp}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const output = {
    timestamp: new Date().toISOString(),
    base_url: SMOKE_BASE_URL,
    campaign_id: campaignId,
    skip_generation: skipGeneration,
    budget_remaining_usd: getBudgetRemaining(),
    passed,
    failed,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(`Budget remaining: $${getBudgetRemaining().toFixed(2)}`);
  console.log(`Output:  ${outputPath}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("CAP smoke test fatal error:", err);
  process.exit(1);
});
