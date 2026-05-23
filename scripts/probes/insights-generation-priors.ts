#!/usr/bin/env tsx
export {};
/**
 * scripts/probes/insights-generation-priors.ts
 *
 * LAYER 7 — Live probe for GET /api/insights/generation-priors.
 *
 * Usage:
 *   PROBE_BASE_URL=https://opollo-site-builder.vercel.app \
 *   CRON_SECRET=<secret> \
 *   PROBE_COMPANY_ID=<uuid> \
 *   npx tsx scripts/probes/insights-generation-priors.ts
 *
 * Required env:
 *   PROBE_BASE_URL   — base URL of the deployed app
 *   CRON_SECRET      — cron secret header value
 *   PROBE_COMPANY_ID — a fixture company UUID with insights data
 */

const base = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET ?? "";
const companyId = process.env.PROBE_COMPANY_ID ?? "";

const PLATFORMS = ["LINKEDIN", "FACEBOOK"] as const;

const REQUIRED_FIELDS = [
  "version",
  "generated_at",
  "company_id",
  "platform",
  "content_type",
  "arc_phase",
  "winning_topics",
  "weak_topics",
  "preferred_hook_patterns",
  "dismissed_recommendation_types",
  "tone_or_formatting_flags",
  "client_editing_preferences",
  "media_type_ranking",
  "confidence_overall",
  "priors_text",
] as const;

async function probe(platform: string): Promise<boolean> {
  const url = `${base}/api/insights/generation-priors?company_id=${encodeURIComponent(companyId)}&platform=${platform}`;
  console.log(`\n## Probing ${platform}`);
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: { "X-Cron-Secret": cronSecret },
    });

    console.log(`Status: ${res.status}`);

    if (res.status === 503) {
      console.log("503 INSIGHTS_UNAVAILABLE — no data for this company (expected for new companies)");
      return true; // Not a failure — just no data yet
    }

    if (!res.ok) {
      const body = await res.text();
      console.error(`FAIL: non-2xx response\n${body}`);
      return false;
    }

    const data = await res.json();

    const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
    if (missing.length > 0) {
      console.error(`FAIL: missing fields: ${missing.join(", ")}`);
      return false;
    }

    if (data.version !== "1") {
      console.error(`FAIL: version is "${data.version}", expected "1"`);
      return false;
    }

    if (data.company_id !== companyId) {
      console.error(`FAIL: company_id mismatch: got ${data.company_id}`);
      return false;
    }

    if (data.platform !== platform) {
      console.error(`FAIL: platform mismatch: got ${data.platform}`);
      return false;
    }

    console.log(`confidence_overall: ${data.confidence_overall}`);
    console.log(`data_freshness_iso: ${data.data_freshness_iso}`);
    console.log(`priors_text length: ${data.priors_text?.length ?? 0} chars`);
    console.log(`dismissed_types: ${JSON.stringify(data.dismissed_recommendation_types)}`);
    console.log("PASS");
    return true;
  } catch (err) {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("# Insights Generation-Priors Probe");
  console.log(`Base URL: ${base}`);
  console.log(`Company ID: ${companyId}`);

  if (!companyId) {
    console.error("PROBE_COMPANY_ID env var required");
    process.exit(1);
  }

  // Probe auth gate
  console.log("\n## Auth gate");
  const noAuthRes = await fetch(
    `${base}/api/insights/generation-priors?company_id=${encodeURIComponent(companyId)}&platform=LINKEDIN`,
  );
  if (noAuthRes.status !== 401) {
    console.error(`FAIL: expected 401 without cron secret, got ${noAuthRes.status}`);
    process.exit(1);
  }
  console.log("PASS: 401 without cron secret");

  // Probe validation
  console.log("\n## Validation");
  const badPlatformRes = await fetch(
    `${base}/api/insights/generation-priors?company_id=${encodeURIComponent(companyId)}&platform=TWITTER`,
    { headers: { "X-Cron-Secret": cronSecret } },
  );
  if (badPlatformRes.status !== 400) {
    console.error(`FAIL: expected 400 for invalid platform, got ${badPlatformRes.status}`);
    process.exit(1);
  }
  console.log("PASS: 400 for invalid platform");

  let allPass = true;
  for (const platform of PLATFORMS) {
    const ok = await probe(platform);
    if (!ok) allPass = false;
  }

  if (!allPass) {
    console.error("\n## PROBE FAILED");
    process.exit(1);
  }

  console.log("\n## All probes PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
