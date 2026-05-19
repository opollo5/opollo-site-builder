#!/usr/bin/env tsx
/**
 * scripts/smoke/composer.smoke.ts
 *
 * Smoke test for the social composer API (Layer 7 — live probe).
 *
 * Exercises: POST /api/platform/social/drafts (draft mode),
 *            GET  /api/platform/social/drafts/[id],
 *            DELETE /api/platform/social/drafts/[id]
 *
 * Required env vars:
 *   SMOKE_BASE_URL          — defaults to https://app.opollo.com
 *   SMOKE_SESSION_COOKIE    — session_token cookie for an authenticated user
 *   SMOKE_TEST_COMPANY_ID   — UUID of the test company
 *   SMOKE_TEST_CONNECTION_ID — UUID of a live social connection for the company
 *
 * Usage:
 *   npx tsx scripts/smoke/composer.smoke.ts
 *
 * Output:
 *   scripts/smoke/output/composer-smoke-{timestamp}.json
 */

import fs from "node:fs";
import path from "node:path";
import { smokePost, smokeGet, smokeDelete, SMOKE_BASE_URL } from "./client";
import { assertStatus, assertShape, assertTruthy } from "./assertions";
import { getTestCompanyId, getTestConnectionId } from "./test-data";

interface SmokeResult {
  step: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  error?: string;
  data?: unknown;
}

const results: SmokeResult[] = [];
let draftId: string | null = null;

async function step(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
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
  const connectionId = getTestConnectionId();

  console.log(`\nComposer smoke test → ${SMOKE_BASE_URL}`);
  console.log(`  company:    ${companyId}`);
  console.log(`  connection: ${connectionId}\n`);

  // Step 1: Create a draft
  await step("POST /api/platform/social/drafts → 201", async () => {
    const res = await smokePost("/api/platform/social/drafts", {
      company_id: companyId,
      content: "[smoke test] composer smoke — auto-cleanup in step 3",
      media_urls: [],
      target_profile_ids: [connectionId],
      mode: "draft",
      approval_required: false,
    });
    assertStatus(res, 201, "create draft");
    const body = (await res.json()) as { ok: boolean; data: { id: string; state: string; content: string } };
    assertTruthy(body.ok, "response.ok should be true");
    assertShape(body.data as Record<string, unknown>, ["id", "state", "content"], "draft shape");
    assertTruthy(body.data.id, "draft id should be present");
    assertTruthy(body.data.state === "draft", `expected state=draft, got ${body.data.state}`);
    draftId = body.data.id;
  });

  // Step 2: Fetch the draft
  await step(`GET /api/platform/social/drafts/${draftId ?? "<id>"} → 200`, async () => {
    assertTruthy(draftId, "draftId must be set from step 1");
    const res = await smokeGet(`/api/platform/social/drafts/${draftId}`);
    assertStatus(res, 200, "get draft");
    const body = (await res.json()) as { ok: boolean; data: { id: string; created_by: string } };
    assertTruthy(body.ok, "response.ok should be true");
    assertShape(body.data as Record<string, unknown>, ["id", "created_by"], "get draft shape");
    assertTruthy(body.data.id === draftId, `id mismatch: ${body.data.id} !== ${draftId}`);
  });

  // Step 3: Delete the draft (cleanup)
  await step(`DELETE /api/platform/social/drafts/${draftId ?? "<id>"} → 204`, async () => {
    assertTruthy(draftId, "draftId must be set from step 1");
    const res = await smokeDelete(`/api/platform/social/drafts/${draftId}`);
    assertStatus(res, 204, "delete draft");
  });

  // Write output
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(import.meta.dirname, "output", `composer-smoke-${timestamp}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const output = {
    timestamp: new Date().toISOString(),
    base_url: SMOKE_BASE_URL,
    passed,
    failed,
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(`Output:  ${outputPath}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test fatal error:", err);
  process.exit(1);
});
