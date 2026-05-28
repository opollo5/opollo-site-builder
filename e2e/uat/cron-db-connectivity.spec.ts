/**
 * UAT spec — Cron direct-postgres database connectivity.
 *
 * The publish-due cron uses lib/db-direct.ts → pg.Client(requireDbConfig())
 * for its FOR UPDATE SKIP LOCKED claim phase. If SUPABASE_DB_URL is set to
 * a direct Supabase host (db.<ref>.supabase.co) instead of the session pooler
 * (aws-0-<region>.pooler.supabase.com), the pg.Client will fail with
 * getaddrinfo ENOTFOUND because direct connections are IPv6-only and Vercel
 * is IPv4-only.
 *
 * This spec fires a single cron tick and asserts the response is not a
 * DB-connection failure. A 200 with { ok: true } means the pg.Client
 * connected successfully. A 500 with { error: "claim_failed" } means the
 * direct-connection issue is back.
 *
 * Requires:
 *   STAGING_CRON_SECRET  — Authorization: Bearer header for internal crons
 *   STAGING_BASE_URL     — defaults to https://opollo-site-builder-git-staging-opollo5.vercel.app
 *
 * If STAGING_CRON_SECRET is not set, all tests skip (same pattern as other
 * UAT specs that require privileged credentials).
 *
 * Run manually:
 *   STAGING_CRON_SECRET=<secret> npx playwright test \
 *     e2e/uat/cron-db-connectivity.spec.ts
 */

import { expect, test } from "@playwright/test";

const STAGING_BASE =
  process.env.STAGING_BASE_URL ??
  "https://opollo-site-builder-git-staging-opollo5.vercel.app";

const CRON_SECRET = process.env.STAGING_CRON_SECRET ?? "";

test.describe("cron direct-postgres DB connectivity (UAT)", () => {
  test.beforeAll(() => {
    if (!CRON_SECRET) {
      test.skip(true, "STAGING_CRON_SECRET not set — skipping cron DB connectivity check");
    }
  });

  test("publish-due cron returns 200, not a DB connection error", async ({
    request,
  }) => {
    if (!CRON_SECRET) test.skip();

    const res = await request.post(`${STAGING_BASE}/api/internal/cron/publish-due`, {
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    // 401 means wrong secret (config issue in test, not a DB issue).
    expect(res.status(), "Got 401 — check STAGING_CRON_SECRET value").not.toBe(401);

    // 500 with claim_failed means the direct-Postgres connection failed.
    // This is the exact failure mode from the 2026-05-27 incident.
    if (res.status() === 500) {
      const body = await res.json().catch(() => ({}));
      expect(
        (body as { error?: string }).error,
        "publish-due returned claim_failed — SUPABASE_DB_URL may be using a direct connection host instead of the session pooler",
      ).not.toBe("claim_failed");
    }

    // 200 with ok:true means the DB connection worked.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect((body as { ok?: boolean }).ok).toBe(true);
  });

  test("db-direct.ts parseDbUrl rejects direct connection host at startup", async ({
    request,
  }) => {
    // Regression smoke: if the env var is wrong, parseDbUrl should throw with
    // a descriptive message before even attempting a connection. We can't
    // directly test parseDbUrl via HTTP, so we verify the cron doesn't return
    // the old cryptic ENOTFOUND payload.
    if (!CRON_SECRET) test.skip();

    const res = await request.post(`${STAGING_BASE}/api/internal/cron/publish-due`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });

    if (!res.ok()) {
      const body = await res.json().catch(() => ({}));
      const bodyStr = JSON.stringify(body);
      // ENOTFOUND indicates DNS failure → direct-connection URL is back.
      expect(bodyStr).not.toContain("ENOTFOUND");
      // claim_failed with no further context was the pre-fix error shape.
      expect((body as { error?: string }).error).not.toBe("claim_failed");
    }
  });
});
