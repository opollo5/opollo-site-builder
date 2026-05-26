/**
 * UAT spec — G10: PATCH /api/platform/social/drafts/[id] with
 * mode='schedule' and target_profile_ids=[] must return 422 MISSING_TARGET_PROFILES.
 *
 * Verifies the guard is live on the staging Vercel deployment.
 *
 * Requires:
 *   STAGING_UAT_EMAIL     — defaults to uat-bot@staging.opollo.com
 *   STAGING_UAT_PASSWORD  — password for the UAT bot account
 *   STAGING_BASE_URL      — defaults to https://opollo-site-builder-git-staging-opollo5.vercel.app
 *
 * If STAGING_UAT_PASSWORD is not set, all tests skip.
 *
 * Run:
 *   STAGING_UAT_PASSWORD=<pw> npx playwright test \
 *     e2e/uat/draft-schedule-requires-targets.spec.ts
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STAGING_BASE =
  process.env.STAGING_BASE_URL ??
  "https://opollo-site-builder-git-staging-opollo5.vercel.app";

const UAT_EMAIL =
  process.env.STAGING_UAT_EMAIL ?? "uat-bot@staging.opollo.com";

const UAT_PASSWORD = process.env.STAGING_UAT_PASSWORD ?? "";

// Known seed draft ID from docs/uat-harness/PREREQUISITES.md.
// The seed script guarantees a draft-state row for the UAT company.
// We use the draft only to get a valid UUID for the endpoint; the
// guard fires before any DB write so the draft state is irrelevant.
const UAT_COMPANY_ID = "ec59a3cd-ce37-477c-a3f5-d5a37a6b51bb";

// ---------------------------------------------------------------------------
// Auth helper — sign in and return the session access token.
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  const res = await fetch(
    `${STAGING_BASE}/api/auth/callback`,
    { method: "GET", redirect: "manual" },
  );
  // We need a proper sign-in; use Supabase's REST auth endpoint directly.
  const supabaseUrl =
    process.env.STAGING_SUPABASE_URL ??
    "https://bjiiqnetaxoibhcaukqm.supabase.co";
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY ?? "";

  const signInRes = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({ email: UAT_EMAIL, password: UAT_PASSWORD }),
    },
  );

  if (!signInRes.ok) {
    const text = await signInRes.text();
    throw new Error(
      `UAT sign-in failed (${signInRes.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await signInRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!data.access_token) {
    throw new Error(
      `UAT sign-in returned no access_token: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  void res; // suppress unused-variable lint
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Helper — get the first draft ID for the UAT company.
// ---------------------------------------------------------------------------

async function getUatDraftId(accessToken: string): Promise<string> {
  const res = await fetch(
    `${STAGING_BASE}/api/platform/social/drafts?company_id=${UAT_COMPANY_ID}&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    // Fall back to a deterministic UUID that the guard will hit before
    // any DB lookup causes a 404 — the guard runs AFTER the draft row
    // is loaded, so we do need a valid draft. Use the seed's known ID
    // if the list endpoint is unavailable.
    throw new Error(
      `Could not list drafts for UAT company (${res.status}). ` +
        "Ensure STAGING_UAT_PASSWORD is set and the seed script has run.",
    );
  }

  const body = (await res.json()) as {
    ok: boolean;
    data?: { drafts?: Array<{ id: string }> };
  };
  const id = body.data?.drafts?.[0]?.id;
  if (!id) {
    throw new Error(
      "No draft found for UAT company. Run `npm run seed:staging` first.",
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("UAT G10: schedule without targets → 422", () => {
  test.skip(!UAT_PASSWORD, "STAGING_UAT_PASSWORD not set — skipping UAT spec.");

  let accessToken: string;
  let draftId: string;

  test.beforeAll(async () => {
    accessToken = await getAccessToken();
    draftId = await getUatDraftId(accessToken);
  });

  test(
    "PATCH mode='schedule' + target_profile_ids=[] → 422",
    async ({ request }) => {
      const res = await request.patch(
        `${STAGING_BASE}/api/platform/social/drafts/${draftId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          data: {
            draft_version: 1,
            content: "UAT test post — schedule guard",
            media_urls: [],
            target_profile_ids: [],
            platform_variants: {},
            mode: "schedule",
            scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
            planned_for_at: null,
            approval_required: false,
            approver_user_id: null,
          },
        },
      );

      expect(res.status()).toBe(422);
      const body = (await res.json()) as {
        ok: boolean;
        error: { code: string; retryable: boolean };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
      expect(body.error.retryable).toBe(false);
    },
  );

  test(
    "PATCH mode='post_now' + target_profile_ids=[] → 422",
    async ({ request }) => {
      const res = await request.patch(
        `${STAGING_BASE}/api/platform/social/drafts/${draftId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          data: {
            draft_version: 1,
            content: "UAT test post — post_now guard",
            media_urls: [],
            target_profile_ids: [],
            platform_variants: {},
            mode: "post_now",
            scheduled_at: null,
            planned_for_at: null,
            approval_required: false,
            approver_user_id: null,
          },
        },
      );

      expect(res.status()).toBe(422);
      const body = (await res.json()) as {
        ok: boolean;
        error: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
    },
  );
});
