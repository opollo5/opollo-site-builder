import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-3 schema tests — brief_pages runner-state columns +
// brief_runs.content_summary.
//
// Pins migration 0018's additive columns:
//
//   brief_pages.page_status         CHECK enum + default 'pending'
//   brief_pages.current_pass_kind   nullable text
//   brief_pages.current_pass_number default 0, CHECK >= 0
//   brief_pages.draft_html          nullable text
//   brief_pages.generated_html      nullable text + coherent CHECK
//   brief_pages.critique_log        NOT NULL DEFAULT '[]'::jsonb
//   brief_pages.approved_at         nullable + coherent CHECK
//   brief_pages.approved_by         FK opollo_users ON DELETE SET NULL
//   brief_runs.content_summary      NOT NULL DEFAULT ''
//
// _setup.ts truncates all tables in beforeEach, so each test seeds a
// fresh site + brief + page inside the test body.
// ---------------------------------------------------------------------------

async function seedBriefWithPage(opts: {
  site_id: string;
}): Promise<{ briefId: string; pageId: string }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.site_id,
      title: `m12-3-schema ${unique}`,
      status: "parsed",
      source_storage_path: `m12-3-schema/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `m12-3-schema-${unique}`,
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedBriefWithPage briefs: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  const pageRes = await svc
    .from("brief_pages")
    .insert({
      brief_id: briefId,
      ordinal: 0,
      title: "Page 0",
      mode: "full_text",
      source_text: "Page source.",
      word_count: 2,
    })
    .select("id")
    .single();
  if (pageRes.error || !pageRes.data) {
    throw new Error(`seedBriefWithPage pages: ${pageRes.error?.message}`);
  }
  return { briefId, pageId: pageRes.data.id as string };
}

describe("M12-3: brief_pages runner-state columns", () => {
  it("inserts a brief_page with runner-state defaults applied", async () => {
    const site = await seedSite();
    const { pageId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("brief_pages")
      .select(
        "page_status, current_pass_kind, current_pass_number, draft_html, generated_html, critique_log, approved_at, approved_by",
      )
      .eq("id", pageId)
      .single();
    expect(error).toBeNull();
    expect(data?.page_status).toBe("pending");
    expect(data?.current_pass_kind).toBeNull();
    expect(data?.current_pass_number).toBe(0);
    expect(data?.draft_html).toBeNull();
    expect(data?.generated_html).toBeNull();
    expect(data?.critique_log).toEqual([]);
    expect(data?.approved_at).toBeNull();
    expect(data?.approved_by).toBeNull();
  });

  it("rejects an invalid page_status value via CHECK", async () => {
    const site = await seedSite();
    const { pageId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("brief_pages")
      .update({ page_status: "weird-state" })
      .eq("id", pageId);
    expect(error).not.toBeNull();
    // Postgres check_violation is 23514.
    expect((error as { code?: string }).code).toBe("23514");
  });

  it("rejects approved_at IS NOT NULL without page_status='approved' (coherent CHECK)", async () => {
    const site = await seedSite();
    const { pageId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("brief_pages")
      .update({ approved_at: new Date().toISOString() })
      .eq("id", pageId);
    expect(error).not.toBeNull();
    expect((error as { code?: string }).code).toBe("23514");
  });

  it("rejects generated_html set without page_status='approved' (coherent CHECK)", async () => {
    const site = await seedSite();
    const { pageId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("brief_pages")
      .update({ generated_html: "<p>hi</p>" })
      .eq("id", pageId);
    expect(error).not.toBeNull();
    expect((error as { code?: string }).code).toBe("23514");
  });

  it("accepts a full approved transition (page_status + approved_at + generated_html together)", async () => {
    const site = await seedSite();
    const { pageId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("brief_pages")
      .update({
        page_status: "approved",
        approved_at: new Date().toISOString(),
        generated_html: "<p>approved</p>",
        draft_html: "<p>approved</p>",
      })
      .eq("id", pageId)
      .select("page_status, generated_html")
      .single();
    expect(error).toBeNull();
    expect(data?.page_status).toBe("approved");
    expect(data?.generated_html).toBe("<p>approved</p>");
  });
});

describe("M12-3: brief_runs.content_summary", () => {
  it("defaults to empty string on a fresh brief_runs row", async () => {
    const site = await seedSite();
    const { briefId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId })
      .select("content_summary")
      .single();
    expect(error).toBeNull();
    expect(data?.content_summary).toBe("");
  });

  it("round-trips a non-empty content_summary", async () => {
    const site = await seedSite();
    const { briefId } = await seedBriefWithPage({ site_id: site.id });
    const svc = getServiceRoleClient();
    const summary = "Page 1 approved.\nPage 2 approved.";
    const { data, error } = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, content_summary: summary })
      .select("content_summary")
      .single();
    expect(error).toBeNull();
    expect(data?.content_summary).toBe(summary);
  });
});
