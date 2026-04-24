import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  E2E_CRON_SECRET,
  E2E_TEST_SITE_PREFIX,
} from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M12-6 — full-loop E2E for the brief runner.
//
// Drives the operator path end-to-end: upload → parse → commit → start
// run → drive cron ticks → approve → approve → cancel → assert approved
// pages survive.
//
// The runner actually ticks via /api/cron/process-brief-runner. Because
// ANTHROPIC_API_KEY is NOT set in the E2E env, the cron routes to
// dummyAnthropicCall + dummyVisualRender (see lib/brief-runner-dummy).
// That exercises the full state machine — lease / heartbeat / CAS /
// critique_log writes / visual review loop / awaiting_review transition
// — without burning Anthropic tokens.
//
// auditA11y runs on every visited admin page.
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

async function triggerCronTick(request: APIRequestContext): Promise<{
  processedRunId: string | null;
  outcome: string | null;
}> {
  const res = await request.post("/api/cron/process-brief-runner", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    data: { processedRunId: string | null; outcome: string | null };
  };
  expect(body.ok).toBe(true);
  return body.data;
}

async function driveUntilAwaitingReview(opts: {
  page: Page;
  request: APIRequestContext;
  briefId: string;
  expectedOrdinal: number;
  maxTicks?: number;
}): Promise<void> {
  const svc = supabaseServiceClient();
  const maxTicks = opts.maxTicks ?? 6;
  for (let i = 0; i < maxTicks; i++) {
    await triggerCronTick(opts.request);
    const check = await svc
      .from("brief_pages")
      .select("page_status")
      .eq("brief_id", opts.briefId)
      .eq("ordinal", opts.expectedOrdinal)
      .single();
    if (check.data?.page_status === "awaiting_review") {
      return;
    }
  }
  throw new Error(
    `Page at ordinal ${opts.expectedOrdinal} did not reach awaiting_review after ${maxTicks} ticks.`,
  );
}

async function seedCommittedBrief(opts: {
  siteId: string;
  pageCount: number;
}): Promise<{ briefId: string }> {
  const svc = supabaseServiceClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.siteId,
      title: `E2E full-loop ${unique}`,
      status: "committed",
      source_storage_path: `e2e-full/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 256,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `e2e-full-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "a".repeat(64),
      brand_voice: "Warm and direct.",
      design_direction: "Editorial.",
      // Use Haiku for speed; the dummy call ignores the model.
      text_model: "claude-haiku-4-5-20251001",
      visual_model: "claude-haiku-4-5-20251001",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedCommittedBrief: ${briefRes.error?.message}`);
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

test.describe("M12-6 briefs — full-loop run", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("start run → approve page 1 → approve page 2 → cancel → pages survive", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const site = await findTestSite();
    const { briefId } = await seedCommittedBrief({
      siteId: site.id,
      pageCount: 3,
    });
    const svc = supabaseServiceClient();

    // 1. Navigate to the run surface.
    await page.goto(`/admin/sites/${site.id}/briefs/${briefId}/run`);
    await expect(page.getByRole("heading", { name: /E2E full-loop/ })).toBeVisible();
    await auditA11y(page, testInfo);

    // 2. Start the run. With a generous tenant budget (bumped in seedSite)
    // the CONFIRMATION_REQUIRED path shouldn't trigger for a 3-page brief.
    await page.getByRole("button", { name: /^start run$/i }).click();

    // After start, the page revalidates; the run status pill should render.
    await expect(page.getByText(/awaiting your review|queued|running/i)).toBeVisible({
      timeout: 10_000,
    });

    // 3. Drive the cron until page 0 (ordinal 0) reaches awaiting_review.
    // Each tick advances one page; for ordinal 0 (anchor), text+visual
    // passes run + freeze site_conventions + transition.
    await driveUntilAwaitingReview({
      page,
      request,
      briefId,
      expectedOrdinal: 0,
    });

    // 4. Re-render the surface. Approve button on page 0 should appear.
    await page.reload();
    const page1Card = page.getByRole("heading", { name: /1\. Page 1/ }).locator("..").locator("..");
    await expect(page1Card.getByText(/Awaiting review/i).first()).toBeVisible();
    await page1Card.getByRole("button", { name: /approve this page/i }).click();

    // 5. Drive cron until page 1 (ordinal 1) reaches awaiting_review.
    await driveUntilAwaitingReview({
      page,
      request,
      briefId,
      expectedOrdinal: 1,
    });

    await page.reload();
    await auditA11y(page, testInfo);
    const page2Card = page.getByRole("heading", { name: /2\. Page 2/ }).locator("..").locator("..");
    await expect(page2Card.getByText(/Awaiting review/i).first()).toBeVisible();
    await page2Card.getByRole("button", { name: /approve this page/i }).click();

    // 6. Drive cron until page 2 (ordinal 2) reaches awaiting_review —
    // this is the third page, which we'll cancel instead of approving.
    await driveUntilAwaitingReview({
      page,
      request,
      briefId,
      expectedOrdinal: 2,
    });

    // 7. Cancel the run. The button lives in the header when the run is
    // active/paused. Reload first so the client picks up the paused state.
    await page.reload();
    await page.getByRole("button", { name: /cancel run/i }).click();

    // 8. Assert post-state:
    //   - First two pages approved, generated_html populated
    //   - Third page stays at awaiting_review (cancel leaves state)
    //   - Run is cancelled
    const pagesAfter = await svc
      .from("brief_pages")
      .select("ordinal, page_status, generated_html")
      .eq("brief_id", briefId)
      .order("ordinal");
    const rows = pagesAfter.data as Array<{
      ordinal: number;
      page_status: string;
      generated_html: string | null;
    }>;
    expect(rows[0]!.page_status).toBe("approved");
    expect(rows[0]!.generated_html).toBeTruthy();
    expect(rows[1]!.page_status).toBe("approved");
    expect(rows[1]!.generated_html).toBeTruthy();
    expect(rows[2]!.page_status).toBe("awaiting_review");

    const runAfter = await svc
      .from("brief_runs")
      .select("status")
      .eq("brief_id", briefId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(runAfter.data?.status).toBe("cancelled");
  });
});
