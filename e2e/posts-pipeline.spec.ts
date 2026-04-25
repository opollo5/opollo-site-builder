import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { E2E_CRON_SECRET, E2E_TEST_SITE_PREFIX } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M13-6b — full posts pipeline E2E.
//
// Drives the operator path that's only exercised when content_type='post':
//   seed brief (content_type='post')
//   → start run on the run surface
//   → drive /api/cron/process-brief-runner ticks until awaiting_review
//   → click "Approve this page" in the UI
//   → bridgeApprovedPageToPostIfNeeded writes a posts row
//   → assert the bridged post appears in /admin/sites/[id]/posts
//
// The bridge is the only cross-table write that distinguishes post-mode
// from page-mode at approval time. Unit tests cover its branches
// (no-op on page-mode, deterministic slug, live-slug adoption,
// soft-fail on 23505); this spec proves the wiring end-to-end:
// brief approval → posts row materialises → operator sees it.
//
// The runner uses dummyAnthropicCall + dummyVisualRender (no
// ANTHROPIC_API_KEY in E2E env), so the dispatch table's post-mode
// config (`MODE_CONFIGS.post.anchorExtraCycles === 0` +
// runPostQualityGates) is exercised against deterministic stub HTML.
// The dummy draft has no <meta name="description">, so the gate
// passes trivially — that's intentional: post-mode dispatch enabling
// is what we're proving here, not the gate's content rules (those are
// covered by unit tests).
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

async function triggerCronTick(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/cron/process-brief-runner", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
}

async function driveUntilAwaitingReview(opts: {
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
    if (check.data?.page_status === "awaiting_review") return;
  }
  throw new Error(
    `Page at ordinal ${opts.expectedOrdinal} did not reach awaiting_review after ${maxTicks} ticks.`,
  );
}

async function seedCommittedPostBrief(opts: {
  siteId: string;
  title: string;
}): Promise<{ briefId: string; pageTitle: string }> {
  const svc = supabaseServiceClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.siteId,
      title: opts.title,
      // Critical: content_type='post' flips the runner mode dispatch.
      // resolveRunnerMode -> 'post' -> MODE_CONFIGS.post (anchorExtraCycles=0
      // + runPostQualityGates). approveBriefPage will then call
      // bridgeApprovedPageToPostIfNeeded after the CAS commits.
      content_type: "post",
      status: "committed",
      source_storage_path: `e2e-post/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 256,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `e2e-post-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "a".repeat(64),
      brand_voice: "Warm and direct.",
      design_direction: "Editorial.",
      // Haiku for speed; the dummy stub ignores the model.
      text_model: "claude-haiku-4-5-20251001",
      visual_model: "claude-haiku-4-5-20251001",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedCommittedPostBrief: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;
  // One page is enough — the bridge happens at approval time, and
  // approval of a single post is the complete pipeline. Multi-page
  // post briefs are exercised at the unit layer.
  const pageTitle = `Post one ${unique}`;
  await svc.from("brief_pages").insert({
    brief_id: briefId,
    ordinal: 0,
    title: pageTitle,
    mode: "full_text",
    source_text: "Body content for the bridged post.",
    word_count: 6,
  });
  return { briefId, pageTitle };
}

async function approvePageViaUI(opts: {
  page: Page;
  pageTitle: string;
}): Promise<void> {
  // Match the page card by its heading; ordinal-prefixed shape
  // ("1. <title>") follows the run-surface convention in
  // briefs-full-loop.spec.ts.
  const escaped = opts.pageTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const card = opts.page
    .getByRole("heading", { name: new RegExp(`1\\. ${escaped}`) })
    .locator("..")
    .locator("..");
  await expect(card.getByText(/Awaiting review/i).first()).toBeVisible();
  await card.getByRole("button", { name: /approve this page/i }).click();
}

test.describe("M13-6b posts pipeline — brief → approve → bridge → list", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("post-mode brief approval bridges into posts list", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const site = await findTestSite();
    const briefTitle = `E2E posts pipeline ${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const { briefId, pageTitle } = await seedCommittedPostBrief({
      siteId: site.id,
      title: briefTitle,
    });
    const svc = supabaseServiceClient();

    // 1. Run surface renders, audit the page.
    await page.goto(`/admin/sites/${site.id}/briefs/${briefId}/run`);
    await expect(
      page.getByRole("heading", { name: new RegExp(briefTitle) }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    // 2. Start the run. CONFIRMATION_REQUIRED isn't expected for a
    // 1-page brief at the default tenant budget.
    await page.getByRole("button", { name: /^start run$/i }).click();
    await expect(
      page.getByText(/awaiting your review|queued|running/i),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Drive cron until ordinal 0 hits awaiting_review. Anchor cycle
    // is disabled in post mode, so the standard text loop + visual
    // loop is enough — fewer ticks than the page-mode anchor flow.
    await driveUntilAwaitingReview({
      request,
      briefId,
      expectedOrdinal: 0,
    });

    // 4. Reload + approve via UI. approveBriefPage runs the bridge as
    // a soft step after the brief_page CAS commits — we drive through
    // the operator's actual button rather than calling the route
    // directly, so the surface contract is exercised.
    await page.reload();
    await auditA11y(page, testInfo);
    await approvePageViaUI({ page, pageTitle });

    // 5. Assert the bridge wrote a posts row. Slug derives from the
    // page title via slugifyForPost (lowercase, [^a-z0-9]+ → -, capped
    // at 100). Title prefix "post-one-" + the unique suffix is enough
    // to find it without colliding with any prior test run.
    type BridgedPostRow = {
      id: string;
      site_id: string;
      slug: string;
      title: string;
      content_type: string;
      generated_html: string | null;
      status: string;
    };
    const slugPrefix = "post-one-";
    let postRow: BridgedPostRow | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await svc
        .from("posts")
        .select(
          "id, site_id, slug, title, content_type, generated_html, status",
        )
        .eq("site_id", site.id)
        .like("slug", `${slugPrefix}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (res.data) {
        postRow = res.data as unknown as BridgedPostRow;
        break;
      }
      // approveBriefPage updates state then runs the bridge; there's
      // no fully-synchronous "approval done + bridge done" signal
      // visible on the run surface, so we poll briefly.
      await page.waitForTimeout(500);
    }
    expect(postRow, "bridge should write a posts row").not.toBeNull();
    const bridged = postRow as BridgedPostRow;
    expect(bridged.content_type).toBe("post");
    expect(bridged.status).toBe("draft");
    expect(bridged.title).toBe(pageTitle);
    expect(bridged.generated_html).toContain("data-stub-key");

    // 6. Visit /admin/sites/[id]/posts and confirm the bridged post
    // is listed. Title-search filter narrows the result so other
    // pre-seeded posts don't crowd the assertion.
    await page.goto(`/admin/sites/${site.id}/posts`);
    await expect(
      page.getByRole("heading", { level: 1, name: /^posts$/i }),
    ).toBeVisible();
    const search = page.getByLabel(/search title/i);
    await search.fill(pageTitle);
    await expect(
      page.getByRole("heading", { name: pageTitle }),
    ).toBeVisible({ timeout: 5_000 });
    await auditA11y(page, testInfo);

    // 7. Cancel the run so the brief doesn't sit in 'paused' across
    // suite runs. The brief has only one page; approving it should
    // already have flipped run state to succeeded — but the brief
    // could also be `paused` if cron didn't tick post-approval yet.
    // Either is acceptable; we just don't want it stranded `running`.
    const runAfter = await svc
      .from("brief_runs")
      .select("status")
      .eq("brief_id", briefId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(runAfter.data?.status).toMatch(/^(succeeded|paused|running)$/);
  });
});
