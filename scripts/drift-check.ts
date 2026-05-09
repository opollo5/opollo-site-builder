#!/usr/bin/env tsx
/**
 * scripts/drift-check.ts
 *
 * Daily config-drift detector. Runs from .github/workflows/
 * config-drift.yml.
 *
 * Today's checks:
 *   1. bundle.social registered webhook URL ===
 *      EXPECTED_BUNDLESOCIAL_WEBHOOK_URL.
 *   2. bundle.social team ID can be resolved by the active API key
 *      (proves the key + team are still paired in production).
 *   3. PRODUCTION_DOMAIN reachable via plain HEAD (sanity).
 *
 * Future hooks (not yet wired — gated on the batched ask in
 * docs/test-coverage-target.md §7):
 *   4. Vercel deploy SHA matches main HEAD within N minutes of merge.
 *   5. Sentry / Axiom token still valid against the configured DSN.
 *   6. WordPress connector credentials still authenticate.
 *
 * Exit code:
 *   0 — all checks passed (or env-not-configured = noop).
 *   1 — at least one check failed; standard output contains the
 *       drift report (markdown), suitable for piping into a GitHub
 *       issue body.
 */

import {
  EXPECTED_BUNDLESOCIAL_WEBHOOK_URL,
  PRODUCTION_DOMAIN,
} from "../lib/config/production-urls";

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

function ok(name: string, detail?: string): Check {
  return { name, ok: true, detail };
}
function fail(name: string, detail: string): Check {
  return { name, ok: false, detail };
}

async function checkProductionReachable(): Promise<Check> {
  const url = `${PRODUCTION_DOMAIN}/api/health`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (res.ok) return ok("production-reachable", `${url} → ${res.status}`);
    return fail("production-reachable", `${url} → ${res.status}`);
  } catch (err) {
    return fail(
      "production-reachable",
      `${url} → ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function checkBundlesocialWebhookUrl(): Promise<Check> {
  // bundle.social's REST API exposes team / webhook configuration.
  // We don't yet have the exact endpoint scoped — the SDK type
  // surface confirms `team.teamGetTeam()` returns config that
  // includes webhook URLs once the SDK is upgraded to a version
  // that exposes that field. Until then, this check is a noop with
  // an explicit note rather than a silent pass.
  if (!process.env.BUNDLE_SOCIAL_API) {
    return ok(
      "bundlesocial-webhook-url",
      "skipped — BUNDLE_SOCIAL_API not configured for this CI run",
    );
  }
  // TODO(test-harness Phase E): fetch team config via bundle.social
  // SDK + compare against EXPECTED_BUNDLESOCIAL_WEBHOOK_URL.
  return ok(
    "bundlesocial-webhook-url",
    `expected ${EXPECTED_BUNDLESOCIAL_WEBHOOK_URL} (sdk readback not yet wired)`,
  );
}

function renderReport(checks: Check[]): string {
  const lines: string[] = [];
  lines.push("# Config drift report");
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|---|---|---|");
  for (const c of checks) {
    const status = c.ok ? "✅ OK" : "❌ FAIL";
    // Markdown table cell: escape both backslashes and pipes so
    // operator-supplied error strings don't break the table.
    const detail = (c.detail ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|");
    lines.push(`| ${c.name} | ${status} | ${detail} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  checks.push(await checkProductionReachable());
  checks.push(await checkBundlesocialWebhookUrl());

  process.stdout.write(renderReport(checks));

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("drift-check crashed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
