import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-5 — unit tests for the three new run-surface routes:
//   POST /api/briefs/[brief_id]/run     (start run + CONFIRMATION_REQUIRED)
//   POST /api/briefs/[brief_id]/cancel  (idempotent cancel)
//   POST /api/briefs/[brief_id]/pages/[page_id]/revise  (revise with note)
//
// Runs with FEATURE_SUPABASE_AUTH off so requireAdminForApi allows.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as startRunPOST, GET as startRunGET } from "@/app/api/briefs/[brief_id]/run/route";
import { POST as cancelPOST } from "@/app/api/briefs/[brief_id]/cancel/route";
import { POST as revisePOST } from "@/app/api/briefs/[brief_id]/pages/[page_id]/revise/route";

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

async function seedCommittedBriefWithPages(
  siteId: string,
  pageCount: number,
): Promise<{ briefId: string; pageIds: string[] }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `run-routes-test ${unique}`,
      status: "committed",
      source_storage_path: `run-routes/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `run-routes-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "e".repeat(64),
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seed brief: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;
  const pageIds: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const r = await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId,
        ordinal: i,
        title: `Page ${i}`,
        mode: "full_text",
        source_text: `Content for page ${i}.`,
        word_count: 3,
      })
      .select("id")
      .single();
    if (r.error || !r.data) throw new Error(`seed page ${i}: ${r.error?.message}`);
    pageIds.push(r.data.id as string);
  }
  return { briefId, pageIds };
}

describe("POST /api/briefs/[brief_id]/run — start run", () => {
  it("happy path: 200 with brief_run_id + estimate_cents", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);

    const req = new Request(`http://localhost/api/briefs/${briefId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await startRunPOST(req, { params: { brief_id: briefId } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: {
        brief_run_id: string;
        estimate_cents: number;
        remaining_budget_cents: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.brief_run_id).toBeTruthy();
    expect(body.data?.estimate_cents).toBeGreaterThan(0);
  });

  it("CONFIRMATION_REQUIRED (429) when estimate > 50% of remaining budget; re-submit with confirmed:true succeeds", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    await svc
      .from("tenant_cost_budgets")
      .update({
        monthly_cap_cents: 100,
        monthly_usage_cents: 0,
      })
      .eq("site_id", site.id);

    const first = await startRunPOST(
      new Request(`http://localhost/api/briefs/${briefId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { brief_id: briefId } },
    );
    // CONFIRMATION_REQUIRED maps to 403 per lib/tool-schemas.ts
    // errorCodeToStatus (shared with the FORBIDDEN code class). The
    // client reads the error.code field, not the HTTP status, to open
    // the confirmation modal — see BriefRunClient.handleStartRun.
    expect(first.status).toBe(403);
    const firstBody = (await first.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(firstBody.ok).toBe(false);
    expect(firstBody.error.code).toBe("CONFIRMATION_REQUIRED");

    const second = await startRunPOST(
      new Request(`http://localhost/api/briefs/${briefId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: { brief_id: briefId } },
    );
    expect(second.status).toBe(200);
  });

  it("BRIEF_RUN_ALREADY_ACTIVE (409) on a second start", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 2);
    const first = await startRunPOST(
      new Request(`http://localhost/api/briefs/${briefId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { brief_id: briefId } },
    );
    expect(first.status).toBe(200);
    const second = await startRunPOST(
      new Request(`http://localhost/api/briefs/${briefId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { brief_id: briefId } },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe("BRIEF_RUN_ALREADY_ACTIVE");
  });

  it("GET returns estimate + remaining_budget + page_count without side effects", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 3);
    const res = await startRunGET(
      new Request(`http://localhost/api/briefs/${briefId}/run`),
      { params: { brief_id: briefId } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        estimate_cents: number;
        page_count: number;
        remaining_budget_cents: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.page_count).toBe(3);
    expect(body.data.estimate_cents).toBeGreaterThan(0);
    // GET doesn't insert a run row.
    const svc = getServiceRoleClient();
    const runs = await svc
      .from("brief_runs")
      .select("id")
      .eq("brief_id", briefId);
    expect(runs.data?.length ?? 0).toBe(0);
  });
});

describe("POST /api/briefs/[brief_id]/cancel", () => {
  it("idempotent: returns already_cancelled:true when no active run", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBriefWithPages(site.id, 1);
    const res = await cancelPOST(
      new Request(`http://localhost/api/briefs/${briefId}/cancel`, {
        method: "POST",
      }),
      { params: { brief_id: briefId } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { already_cancelled?: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.already_cancelled).toBe(true);
  });

  it("cancels an active run and leaves brief_pages rows untouched", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { briefId, pageIds } = await seedCommittedBriefWithPages(site.id, 2);
    await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "running" });

    // Also mark one page as approved (simulating mid-run progress).
    await svc
      .from("brief_pages")
      .update({
        page_status: "approved",
        draft_html: "<p>hi</p>",
        generated_html: "<p>hi</p>",
        approved_at: new Date().toISOString(),
      })
      .eq("id", pageIds[0]!);

    const res = await cancelPOST(
      new Request(`http://localhost/api/briefs/${briefId}/cancel`, {
        method: "POST",
      }),
      { params: { brief_id: briefId } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { status?: string; already_cancelled?: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.already_cancelled).toBe(false);
    expect(body.data.status).toBe("cancelled");

    const after = await svc
      .from("brief_runs")
      .select("status, cancel_requested_at, finished_at")
      .eq("brief_id", briefId)
      .single();
    expect(after.data?.status).toBe("cancelled");
    expect(after.data?.cancel_requested_at).not.toBeNull();

    // Approved page still in place.
    const page = await svc
      .from("brief_pages")
      .select("page_status, generated_html")
      .eq("id", pageIds[0]!)
      .single();
    expect(page.data?.page_status).toBe("approved");
    expect(page.data?.generated_html).toBe("<p>hi</p>");
  });

  it("NOT_FOUND (404) for an unknown brief id", async () => {
    const fake = "00000000-0000-4000-8000-000000000000";
    const res = await cancelPOST(
      new Request(`http://localhost/api/briefs/${fake}/cancel`, {
        method: "POST",
      }),
      { params: { brief_id: fake } },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/briefs/[brief_id]/pages/[page_id]/revise", () => {
  async function seedAwaitingReviewPage(
    siteId: string,
  ): Promise<{
    briefId: string;
    pageId: string;
    pageVersionLock: number;
  }> {
    const svc = getServiceRoleClient();
    const { briefId, pageIds } = await seedCommittedBriefWithPages(siteId, 1);
    const pageId = pageIds[0]!;
    await svc
      .from("brief_pages")
      .update({
        draft_html: "<section><h1>First draft</h1></section>",
      })
      .eq("id", pageId);
    const upd = await svc
      .from("brief_pages")
      .update({ page_status: "awaiting_review" })
      .eq("id", pageId)
      .select("version_lock")
      .single();
    return {
      briefId,
      pageId,
      pageVersionLock: upd.data!.version_lock as number,
    };
  }

  it("happy path: appends note, resets to pending, clears draft_html", async () => {
    const site = await seedSite();
    const { briefId, pageId, pageVersionLock } = await seedAwaitingReviewPage(
      site.id,
    );

    const res = await revisePOST(
      new Request(
        `http://localhost/api/briefs/${briefId}/pages/${pageId}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: pageVersionLock,
            note: "Make the hero punchier.",
          }),
        },
      ),
      { params: { brief_id: briefId, page_id: pageId } },
    );
    expect(res.status).toBe(200);

    const svc = getServiceRoleClient();
    const after = await svc
      .from("brief_pages")
      .select(
        "page_status, current_pass_kind, current_pass_number, draft_html, operator_notes, quality_flag",
      )
      .eq("id", pageId)
      .single();
    expect(after.data?.page_status).toBe("pending");
    expect(after.data?.current_pass_kind).toBeNull();
    expect(after.data?.current_pass_number).toBe(0);
    expect(after.data?.draft_html).toBeNull();
    expect(after.data?.quality_flag).toBeNull();
    expect(after.data?.operator_notes).toContain("Make the hero punchier.");
  });

  it("INVALID_STATE (409) when page is not in awaiting_review", async () => {
    const site = await seedSite();
    const { briefId, pageIds } = await seedCommittedBriefWithPages(site.id, 1);
    const pageId = pageIds[0]!;
    // Leave as pending (default).
    const res = await revisePOST(
      new Request(
        `http://localhost/api/briefs/${briefId}/pages/${pageId}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: 0, note: "x" }),
        },
      ),
      { params: { brief_id: briefId, page_id: pageId } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_STATE");
  });

  it("VERSION_CONFLICT (409) on stale expected_version_lock", async () => {
    const site = await seedSite();
    const { briefId, pageId, pageVersionLock } = await seedAwaitingReviewPage(
      site.id,
    );
    const res = await revisePOST(
      new Request(
        `http://localhost/api/briefs/${briefId}/pages/${pageId}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: pageVersionLock + 5,
            note: "stale",
          }),
        },
      ),
      { params: { brief_id: briefId, page_id: pageId } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  it("NOT_FOUND (404) on brief_id/page_id mismatch", async () => {
    const site = await seedSite();
    const { pageId, pageVersionLock } = await seedAwaitingReviewPage(site.id);
    const { briefId: otherBriefId } = await seedAwaitingReviewPage(site.id);
    const res = await revisePOST(
      new Request(
        `http://localhost/api/briefs/${otherBriefId}/pages/${pageId}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: pageVersionLock,
            note: "mismatch",
          }),
        },
      ),
      { params: { brief_id: otherBriefId, page_id: pageId } },
    );
    expect(res.status).toBe(404);
  });

  it("VALIDATION_FAILED (400) on empty note", async () => {
    const site = await seedSite();
    const { briefId, pageId, pageVersionLock } = await seedAwaitingReviewPage(
      site.id,
    );
    const res = await revisePOST(
      new Request(
        `http://localhost/api/briefs/${briefId}/pages/${pageId}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: pageVersionLock,
            note: "",
          }),
        },
      ),
      { params: { brief_id: briefId, page_id: pageId } },
    );
    expect(res.status).toBe(400);
  });
});

describe("commit route — model-tier persistence", () => {
  it("persists text_model + visual_model when supplied on commit", async () => {
    const { POST: commitPOST } = await import(
      "@/app/api/briefs/[brief_id]/commit/route"
    );
    const { POST: uploadBriefPOST } = await import(
      "@/app/api/briefs/upload/route"
    );

    // Seed a parsed brief via the upload route so we have a realistic
    // version_lock + page_hash to commit with.
    const site = await seedSite({ prefix: "mt1a" });
    const svc = getServiceRoleClient();

    const form = new FormData();
    form.append("site_id", site.id);
    form.append(
      "file",
      new Blob(["## Home\n\nHome copy.\n\n## About\n\nAbout copy.\n"], {
        type: "text/markdown",
      }),
      "brief.md",
    );
    const uploadRes = await uploadBriefPOST(
      new Request("http://localhost/api/briefs/upload", {
        method: "POST",
        body: form,
      }),
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { brief_id: string };
    };
    const briefId = uploadBody.data.brief_id;

    const brief = await svc
      .from("briefs")
      .select("version_lock")
      .eq("id", briefId)
      .single();
    const pages = await svc
      .from("brief_pages")
      .select("ordinal, title, mode, source_text")
      .eq("brief_id", briefId)
      .order("ordinal");

    const { computePageHash } = await import("@/lib/briefs");
    const hash = computePageHash(pages.data ?? []);

    const commitRes = await commitPOST(
      new Request(`http://localhost/api/briefs/${briefId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: brief.data!.version_lock,
          page_hash: hash,
          text_model: "claude-opus-4-7",
          visual_model: "claude-haiku-4-5-20251001",
        }),
      }),
      { params: { brief_id: briefId } },
    );
    expect(commitRes.status).toBe(200);

    const after = await svc
      .from("briefs")
      .select("text_model, visual_model")
      .eq("id", briefId)
      .single();
    expect(after.data?.text_model).toBe("claude-opus-4-7");
    expect(after.data?.visual_model).toBe("claude-haiku-4-5-20251001");
  });

  it("rejects non-allowlisted model strings with VALIDATION_FAILED (400)", async () => {
    const { POST: commitPOST } = await import(
      "@/app/api/briefs/[brief_id]/commit/route"
    );
    const fake = "00000000-0000-4000-8000-000000000000";
    const res = await commitPOST(
      new Request(`http://localhost/api/briefs/${fake}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: 0,
          page_hash: "x".repeat(64),
          text_model: "definitely-not-a-model",
        }),
      }),
      { params: { brief_id: fake } },
    );
    expect(res.status).toBe(400);
  });
});
