#!/usr/bin/env tsx
export {};
/**
 * scripts/probes/insights-recommendations.ts
 *
 * LAYER 7 — Live probe for GET /api/insights/recommendations
 * and the consent/priors surfaces that feed it.
 *
 * Usage:
 *   PROBE_BASE_URL=https://opollo-site-builder.vercel.app \
 *   PROBE_ACCESS_TOKEN=<bearer-token> \
 *   PROBE_COMPANY_ID=<uuid> \
 *   npx tsx scripts/probes/insights-recommendations.ts
 *
 * Required env:
 *   PROBE_BASE_URL      — base URL of the deployed app
 *   PROBE_ACCESS_TOKEN  — a valid session JWT for a user with view_insights access
 *   PROBE_COMPANY_ID    — a fixture company UUID with insights data
 */

const base = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
const token = process.env.PROBE_ACCESS_TOKEN ?? "";
const companyId = process.env.PROBE_COMPANY_ID ?? "";

const PLATFORMS = ["LINKEDIN", "FACEBOOK"] as const;

async function probeAuth(): Promise<boolean> {
  console.log("\n## Auth gate");
  const res = await fetch(
    `${base}/api/insights/recommendations?company_id=${encodeURIComponent(companyId)}&platform=LINKEDIN`,
  );
  if (res.status !== 401) {
    console.error(`FAIL: expected 401 without auth, got ${res.status}`);
    return false;
  }
  console.log("PASS: 401 without auth token");
  return true;
}

async function probeValidation(): Promise<boolean> {
  console.log("\n## Validation");
  const headers = { Authorization: `Bearer ${token}` };

  const noPlatform = await fetch(
    `${base}/api/insights/recommendations?company_id=${encodeURIComponent(companyId)}`,
    { headers },
  );
  if (noPlatform.status !== 400) {
    console.error(`FAIL: expected 400 for missing platform, got ${noPlatform.status}`);
    return false;
  }
  console.log("PASS: 400 for missing platform");

  const badPlatform = await fetch(
    `${base}/api/insights/recommendations?company_id=${encodeURIComponent(companyId)}&platform=TWITTER`,
    { headers },
  );
  if (badPlatform.status !== 400) {
    console.error(`FAIL: expected 400 for invalid platform, got ${badPlatform.status}`);
    return false;
  }
  console.log("PASS: 400 for invalid platform");

  return true;
}

async function probeRecommendations(platform: string): Promise<boolean> {
  console.log(`\n## Recommendations — ${platform}`);
  const url = `${base}/api/insights/recommendations?company_id=${encodeURIComponent(companyId)}&platform=${platform}&limit=5`;
  console.log(`GET ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`Status: ${res.status}`);

  if (!res.ok) {
    const body = await res.text();
    console.error(`FAIL: non-2xx response\n${body}`);
    return false;
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    console.error(`FAIL: expected array, got ${typeof data}`);
    return false;
  }

  console.log(`Recommendations returned: ${data.length}`);

  if (data.length > 0) {
    const rec = data[0];
    const REQUIRED = ["id", "recommendation_type", "headline", "body", "confidence_band"];
    const missing = REQUIRED.filter((f) => !(f in rec));
    if (missing.length > 0) {
      console.error(`FAIL: missing fields in first recommendation: ${missing.join(", ")}`);
      return false;
    }
    console.log(`First rec type: ${rec.recommendation_type}, band: ${rec.confidence_band}`);
  }

  console.log("PASS");
  return true;
}

async function probeConsentRoute(): Promise<boolean> {
  console.log("\n## Consent route");
  const url = `${base}/api/insights/consent`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`Status: ${res.status}`);

  if (res.status === 401) {
    console.error("FAIL: 401 with valid token");
    return false;
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`FAIL: non-2xx response\n${body}`);
    return false;
  }

  const data = await res.json();
  const REQUIRED = ["cross_client_learning_consent", "competitor_tracking_consent"];
  const missing = REQUIRED.filter((f) => !(f in data));
  if (missing.length > 0) {
    console.error(`FAIL: missing consent fields: ${missing.join(", ")}`);
    return false;
  }

  console.log(`cross_client_learning_consent: ${data.cross_client_learning_consent}`);
  console.log(`competitor_tracking_consent: ${data.competitor_tracking_consent}`);
  console.log("PASS");
  return true;
}

async function main(): Promise<void> {
  console.log("# Insights Recommendations Probe");
  console.log(`Base URL: ${base}`);
  console.log(`Company ID: ${companyId}`);

  if (!companyId) {
    console.error("PROBE_COMPANY_ID env var required");
    process.exit(1);
  }
  if (!token) {
    console.error("PROBE_ACCESS_TOKEN env var required");
    process.exit(1);
  }

  let allPass = true;

  if (!(await probeAuth())) allPass = false;
  if (!(await probeValidation())) allPass = false;
  if (!(await probeConsentRoute())) allPass = false;

  for (const platform of PLATFORMS) {
    if (!(await probeRecommendations(platform))) allPass = false;
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
