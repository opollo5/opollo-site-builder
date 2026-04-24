import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { approveBriefPage } from "@/lib/brief-runner";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-3 — POST /api/briefs/[brief_id]/pages/[page_id]/approve.
//
// Route + helper tests. FEATURE_SUPABASE_AUTH is off so requireAdminForApi
// allows; business logic lives in approveBriefPage (exercised directly).
//
// Covers:
//   - happy path: awaiting_review → approved + generated_html promoted +
//     brief_run re-queued at ordinal+1 with content_summary appended.
//   - INVALID_STATE: approve called on pending / already-approved page.
//   - VERSION_CONFLICT: expected_version_lock stale.
//   - NOT_FOUND: page_id doesn't belong to the URL brief_id.
//   - defence-in-depth: route rejects the mismatched brief_id with 404.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST as approvePOST } from "@/app/api/briefs/[brief_id]/pages/[page_id]/approve/route";

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let origEnv: Record<string, string | undefined>;

beforeEach(() => {
  origEnv = {};
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  delete process.env.FEATURE_SUPABASE_AUTH;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
});

async function seedAwaitingReviewPage(opts: {
  siteId: string;
  ordinal?: number;
}): Promise<{
  briefId: string;
  pageId: string;
  pageVersionLock: number;
  runId: string;
}> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.siteId,
      title: `approve-test ${unique}`,
      status: "committed",
      source_storage_path: `approve-test/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `approve-test-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "d".repeat(64),
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seed brief: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  const ordinal = opts.ordinal ?? 0;
  const pageInsert = await svc
    .from("brief_pages")
    .insert({
      brief_id: briefId,
      ordinal,
      title: `Page ${ordinal}`,
      mode: "full_text",
      source_text: "page source",
      word_count: 2,
      draft_html: "<section><h1>Ready</h1><p>Draft to approve.</p></section>",
    })
    .select("id, version_lock")
    .single();
  if (pageInsert.error || !pageInsert.data) {
    throw new Error(`seed page: ${pageInsert.error?.message}`);
  }
  // Transition to awaiting_review via UPDATE (the coherent CHECK forbids
  // inserting awaiting_review with approved_at NULL; inserting pending
  // then updating is the normal runner flow).
  const upd = await svc
    .from("brief_pages")
    .update({ page_status: "awaiting_review" })
    .eq("id", pageInsert.data.id as string)
    .select("version_lock")
    .single();
  if (upd.error || !upd.data) {
    throw new Error(`seed page status: ${upd.error?.message}`);
  }

  const runInsert = await svc
    .from("brief_runs")
    .insert({ brief_id: briefId, status: "paused", current_ordinal: ordinal })
    .select("id")
    .single();
  if (runInsert.error || !runInsert.data) {
    throw new Error(`seed run: ${runInsert.error?.message}`);
  }

  return {
    briefId,
    pageId: pageInsert.data.id as string,
    pageVersionLock: upd.data.version_lock as number,
    runId: runInsert.data.id as string,
  };
}

describe("POST /api/briefs/[brief_id]/pages/[page_id]/approve — happy path", () => {
  it("promotes draft_html → generated_html + approves + re-queues run", async () => {
    const site = await seedSite();
    const { briefId, pageId, pageVersionLock, runId } =
      await seedAwaitingReviewPage({ siteId: site.id });

    const req = new Request(
      `http://localhost/api/briefs/${briefId}/pages/${pageId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: pageVersionLock,
          summary_addendum: "Page 1 approved.",
        }),
      },
    );
    const res = await approvePOST(req, {
      params: { brief_id: briefId, page_id: pageId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { page_status: string; run_status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.page_status).toBe("approved");

    const svc = getServiceRoleClient();
    const pageAfter = await svc
      .from("brief_pages")
      .select("page_status, generated_html, draft_html, approved_at, approved_by")
      .eq("id", pageId)
      .single();
    expect(pageAfter.data?.page_status).toBe("approved");
    expect(pageAfter.data?.generated_html).toBe(
      "<section><h1>Ready</h1><p>Draft to approve.</p></section>",
    );
    expect(pageAfter.data?.draft_html).toBe(
      "<section><h1>Ready</h1><p>Draft to approve.</p></section>",
    );
    expect(pageAfter.data?.approved_at).toBeTruthy();

    const runAfter = await svc
      .from("brief_runs")
      .select("status, current_ordinal, content_summary")
      .eq("id", runId)
      .single();
    expect(runAfter.data?.status).toBe("queued");
    expect(runAfter.data?.current_ordinal).toBe(1);
    expect(runAfter.data?.content_summary).toContain("Page 1 approved.");
  });
});

describe("approve route — error cases", () => {
  it("INVALID_STATE (409): page not in awaiting_review", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const brief = await svc
      .from("briefs")
      .insert({
        site_id: site.id,
        title: `invalid ${unique}`,
        status: "committed",
        source_storage_path: `invalid/${unique}.md`,
        source_mime_type: "text/markdown",
        source_size_bytes: 64,
        source_sha256: "0".repeat(64),
        upload_idempotency_key: `invalid-${unique}`,
        committed_at: new Date().toISOString(),
        committed_page_hash: "e".repeat(64),
      })
      .select("id")
      .single();
    const page = await svc
      .from("brief_pages")
      .insert({
        brief_id: brief.data!.id as string,
        ordinal: 0,
        title: "Pending page",
        mode: "full_text",
        source_text: "pending",
        word_count: 1,
      })
      .select("id, version_lock")
      .single();

    const req = new Request(
      `http://localhost/api/briefs/${brief.data!.id}/pages/${page.data!.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: page.data!.version_lock,
        }),
      },
    );
    const res = await approvePOST(req, {
      params: {
        brief_id: brief.data!.id as string,
        page_id: page.data!.id as string,
      },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_STATE");
  });

  it("VERSION_CONFLICT (409): stale expected_version_lock", async () => {
    const site = await seedSite();
    const { briefId, pageId, pageVersionLock } = await seedAwaitingReviewPage({
      siteId: site.id,
    });

    const req = new Request(
      `http://localhost/api/briefs/${briefId}/pages/${pageId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: pageVersionLock + 5, // stale / wrong
        }),
      },
    );
    const res = await approvePOST(req, {
      params: { brief_id: briefId, page_id: pageId },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  it("NOT_FOUND (404): page_id does not belong to brief_id", async () => {
    const site = await seedSite();
    // Seed two separate briefs; attempt to approve brief A's page via
    // brief B's URL.
    const { pageId, pageVersionLock } = await seedAwaitingReviewPage({
      siteId: site.id,
    });
    const { briefId: otherBriefId } = await seedAwaitingReviewPage({
      siteId: site.id,
      ordinal: 0,
    });

    const req = new Request(
      `http://localhost/api/briefs/${otherBriefId}/pages/${pageId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version_lock: pageVersionLock }),
      },
    );
    const res = await approvePOST(req, {
      params: { brief_id: otherBriefId, page_id: pageId },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("NOT_FOUND (404): unknown page_id", async () => {
    const site = await seedSite();
    const { briefId } = await seedAwaitingReviewPage({ siteId: site.id });
    const fakePageId = "00000000-0000-4000-8000-000000000000";
    const req = new Request(
      `http://localhost/api/briefs/${briefId}/pages/${fakePageId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version_lock: 0 }),
      },
    );
    const res = await approvePOST(req, {
      params: { brief_id: briefId, page_id: fakePageId },
    });
    expect(res.status).toBe(404);
  });

  it("VALIDATION_FAILED (400): non-UUID brief_id", async () => {
    const req = new Request(
      `http://localhost/api/briefs/not-a-uuid/pages/00000000-0000-4000-8000-000000000000/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version_lock: 0 }),
      },
    );
    const res = await approvePOST(req, {
      params: {
        brief_id: "not-a-uuid",
        page_id: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(res.status).toBe(400);
  });
});

describe("approveBriefPage (helper direct) — content_summary append behavior", () => {
  it("default marker is used when summary_addendum is omitted", async () => {
    const site = await seedSite();
    const { pageId, pageVersionLock, runId } = await seedAwaitingReviewPage({
      siteId: site.id,
      ordinal: 2,
    });

    const result = await approveBriefPage({
      pageId,
      expectedVersionLock: pageVersionLock,
      approvedBy: null,
      // no summary_addendum
    });
    expect(result.ok).toBe(true);

    const svc = getServiceRoleClient();
    const run = await svc
      .from("brief_runs")
      .select("content_summary, current_ordinal")
      .eq("id", runId)
      .single();
    // Ordinal 2 approved → "Page 3 approved (ordinal 2)."
    expect(run.data?.content_summary).toContain("Page 3 approved");
    expect(run.data?.current_ordinal).toBe(3);
  });
});
