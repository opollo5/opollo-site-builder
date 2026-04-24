import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M12-5 — run surface E2E.
//
// Covers the UI rendering path only — actually starting a run spends
// Anthropic tokens (even with Sonnet), and the runner's multi-pass
// flow requires a real worker loop. That end-to-end coverage lands in
// M12-6 per the parent plan's testing strategy row.
//
// This spec asserts:
//   1. After a brief is in `status='committed'`, the run surface renders
//      at /admin/sites/[id]/briefs/[brief_id]/run
//   2. Cost estimate + "Start run" button are visible
//   3. Pages render with status pills
//   4. auditA11y on the page
//
// A fresh committed brief is seeded directly via the service-role client
// to avoid coupling to the flagged-fixme commit flow in briefs-review.spec.
// ---------------------------------------------------------------------------

function supabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set for the E2E suite.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedCommittedBriefDirectly(opts: {
  siteId: string;
  pageCount: number;
}): Promise<{ briefId: string }> {
  const svc = supabaseServiceClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.siteId,
      title: `E2E run surface ${unique}`,
      status: "committed",
      source_storage_path: `e2e-run/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 256,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `e2e-run-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "e".repeat(64),
      brand_voice: "Warm and direct.",
      design_direction: "Clean editorial.",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedCommittedBriefDirectly: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;
  for (let i = 0; i < opts.pageCount; i++) {
    await svc.from("brief_pages").insert({
      brief_id: briefId,
      ordinal: i,
      title: `Page ${i + 1}`,
      mode: "full_text",
      source_text: `Content for page ${i + 1}.`,
      word_count: 4,
    });
  }
  return { briefId };
}

async function findTestSite(): Promise<{ id: string }> {
  const svc = supabaseServiceClient();
  const { data, error } = await svc
    .from("sites")
    .select("id")
    .eq("prefix", E2E_TEST_SITE_PREFIX)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `E2E test site not found (prefix ${E2E_TEST_SITE_PREFIX}): ${error?.message ?? "no row"}`,
    );
  }
  return { id: data.id as string };
}

test.describe("M12-5 briefs — run surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("run surface renders cost estimate + start CTA for a committed brief", async ({
    page,
  }, testInfo) => {
    test.setTimeout(30_000);
    const site = await findTestSite();
    const { briefId } = await seedCommittedBriefDirectly({
      siteId: site.id,
      pageCount: 2,
    });

    await page.goto(`/admin/sites/${site.id}/briefs/${briefId}/run`);

    // Brief title visible.
    await expect(
      page.getByRole("heading", { level: 1, name: /E2E run surface/ }),
    ).toBeVisible();

    // Cost panel: estimate + remaining + spent.
    await expect(page.getByRole("heading", { name: /^cost$/i })).toBeVisible();
    await expect(page.getByText(/Estimate/i)).toBeVisible();
    await expect(page.getByText(/Remaining this month/i)).toBeVisible();

    // Start CTA visible (no active run).
    await expect(
      page.getByRole("button", { name: /^start run$/i }),
    ).toBeVisible();

    // Page list renders with ordinal + title.
    await expect(page.getByRole("heading", { name: /^pages$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /1\. Page 1/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /2\. Page 2/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("run surface redirects the operator when brief is not committed", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const site = await findTestSite();
    const svc = supabaseServiceClient();

    // Seed a parsed-but-not-committed brief.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const briefRes = await svc
      .from("briefs")
      .insert({
        site_id: site.id,
        title: `E2E parsed-only ${unique}`,
        status: "parsed",
        source_storage_path: `e2e-parsed/${unique}.md`,
        source_mime_type: "text/markdown",
        source_size_bytes: 64,
        source_sha256: "0".repeat(64),
        upload_idempotency_key: `e2e-parsed-${unique}`,
      })
      .select("id")
      .single();
    if (briefRes.error || !briefRes.data) {
      throw new Error(`seed parsed brief: ${briefRes.error?.message}`);
    }
    const briefId = briefRes.data.id as string;

    await page.goto(`/admin/sites/${site.id}/briefs/${briefId}/run`);

    // The server component renders a "commit first" banner with a link
    // back to the review surface.
    await expect(
      page.getByText(/this brief isn't committed yet/i),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /review and commit/i }),
    ).toBeVisible();
  });
});
