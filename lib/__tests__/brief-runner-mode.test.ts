import { describe, expect, it } from "vitest";

import type { BriefRow } from "@/lib/briefs";
import type {
  AnthropicCallFn,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import {
  MODE_CONFIGS,
  POST_META_DESCRIPTION_MAX,
  processBriefRunTick,
  resolveRunnerMode,
  runPostQualityGates,
} from "@/lib/brief-runner";
import { ANCHOR_EXTRA_CYCLES } from "@/lib/site-conventions";
import type { VisualRenderFn } from "@/lib/visual-review";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-3 — runner mode dispatch + post-specific quality gate tests.
//
// Pins the parent plan's risk mitigation for "Runner mode regression:
// post mode runs anchor cycles anyway. Silent cost blowout.":
//
//   1. MODE_CONFIGS.post.anchorExtraCycles === 0 (dispatch-table
//      invariant — a refactor that flips this back to the page default
//      trips here).
//   2. Integration tick on a mode='post' brief runs the standard
//      3-pass loop (draft + self_critique + revise) and NOT the
//      anchor-extended 3 + ANCHOR_EXTRA_CYCLES loop.
//   3. resolveRunnerMode falls back to 'page' for unrecognised
//      content_type values so a mis-migrated row never sends us into
//      an undefined dispatch entry.
//   4. runPostQualityGates rejects an over-long meta description
//      (parent plan §M13-3 "excerpt length cap").
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unit — MODE_CONFIGS dispatch table
// ---------------------------------------------------------------------------

describe("MODE_CONFIGS", () => {
  it("page mode preserves M12 anchor-cycle behaviour", () => {
    expect(MODE_CONFIGS.page.mode).toBe("page");
    expect(MODE_CONFIGS.page.anchorExtraCycles).toBe(ANCHOR_EXTRA_CYCLES);
  });

  it("post mode disables the anchor cycle entirely", () => {
    expect(MODE_CONFIGS.post.mode).toBe("post");
    expect(MODE_CONFIGS.post.anchorExtraCycles).toBe(0);
  });

  it("page mode's runModeSpecificGates is a no-op", () => {
    expect(MODE_CONFIGS.page.runModeSpecificGates("<p>ok</p>")).toBeNull();
  });

  it("post mode routes through runPostQualityGates", () => {
    // Long meta description should surface a gate failure via the
    // post-mode dispatch entry.
    const html = `<html><head><meta name="description" content="${"a".repeat(POST_META_DESCRIPTION_MAX + 1)}"></head><body><p>Hi</p></body></html>`;
    const gate = MODE_CONFIGS.post.runModeSpecificGates(html);
    expect(gate).not.toBeNull();
    expect(gate?.code).toBe("POST_META_DESCRIPTION_TOO_LONG");
  });
});

// ---------------------------------------------------------------------------
// Unit — resolveRunnerMode
// ---------------------------------------------------------------------------

function makeBrief(overrides: Partial<BriefRow> = {}): BriefRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    site_id: "00000000-0000-0000-0000-000000000002",
    title: "t",
    status: "committed",
    source_storage_path: "x",
    source_mime_type: "text/markdown",
    source_size_bytes: 1,
    source_sha256: "0".repeat(64),
    upload_idempotency_key: "k",
    parser_mode: "structural",
    parser_warnings: [],
    parse_failure_code: null,
    parse_failure_detail: null,
    committed_at: null,
    committed_by: null,
    committed_page_hash: null,
    brand_voice: null,
    design_direction: null,
    text_model: "claude-sonnet-4-6",
    visual_model: "claude-sonnet-4-6",
    content_type: "page",
    version_lock: 1,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("resolveRunnerMode", () => {
  it("returns 'page' for a brief with content_type='page'", () => {
    expect(resolveRunnerMode(makeBrief({ content_type: "page" }))).toBe("page");
  });

  it("returns 'post' for a brief with content_type='post'", () => {
    expect(resolveRunnerMode(makeBrief({ content_type: "post" }))).toBe("post");
  });

  it("falls back to 'page' if an unknown content_type slips through the schema CHECK", () => {
    // CHECK guards against this at the DB, but a backfill bug could set
    // the column to something unexpected. Defensive default avoids an
    // undefined dispatch-table lookup.
    const brief = makeBrief({
      content_type: "something-weird" as unknown as "page",
    });
    expect(resolveRunnerMode(brief)).toBe("page");
  });
});

// ---------------------------------------------------------------------------
// Unit — runPostQualityGates
// ---------------------------------------------------------------------------

describe("runPostQualityGates", () => {
  it("accepts HTML with no meta description", () => {
    expect(runPostQualityGates("<p>Body only.</p>")).toBeNull();
  });

  it("accepts a meta description within the cap", () => {
    const html = `<html><head><meta name="description" content="Short and sweet."></head><body><p>Body.</p></body></html>`;
    expect(runPostQualityGates(html)).toBeNull();
  });

  it("rejects a meta description over POST_META_DESCRIPTION_MAX", () => {
    const longContent = "x".repeat(POST_META_DESCRIPTION_MAX + 10);
    const html = `<html><head><meta name="description" content="${longContent}"></head><body><p>Body.</p></body></html>`;
    const gate = runPostQualityGates(html);
    expect(gate).not.toBeNull();
    expect(gate?.code).toBe("POST_META_DESCRIPTION_TOO_LONG");
  });

  it("accepts a meta description at exactly POST_META_DESCRIPTION_MAX chars", () => {
    const maxContent = "a".repeat(POST_META_DESCRIPTION_MAX);
    const html = `<html><head><meta name="description" content="${maxContent}"></head></html>`;
    expect(runPostQualityGates(html)).toBeNull();
  });

  it("tolerates attribute-order variants (content= before name=)", () => {
    const longContent = "x".repeat(POST_META_DESCRIPTION_MAX + 1);
    const html = `<meta content="${longContent}" name="description">`;
    const gate = runPostQualityGates(html);
    expect(gate?.code).toBe("POST_META_DESCRIPTION_TOO_LONG");
  });

  it("only considers the first meta description tag if multiple are present", () => {
    const short = "Short desc.";
    const long = "x".repeat(POST_META_DESCRIPTION_MAX + 10);
    const html = `<meta name="description" content="${short}"><meta name="description" content="${long}">`;
    expect(runPostQualityGates(html)).toBeNull();
  });

  it("ignores other meta tags (e.g. og:description)", () => {
    const longContent = "x".repeat(POST_META_DESCRIPTION_MAX + 10);
    const html = `<meta property="og:description" content="${longContent}"><p>Body.</p>`;
    expect(runPostQualityGates(html)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration — mode='post' runs the standard 3-pass loop, no anchor cycles
//
// This is the headline risk mitigation: a production mode='post' run
// MUST NOT fire the anchor-extended pass loop (cost blowout). We seed
// a committed brief with content_type='post' + one page, stub Anthropic
// to count calls, and assert the call count is exactly 3 (draft +
// self_critique + revise) rather than 3 + ANCHOR_EXTRA_CYCLES.
// ---------------------------------------------------------------------------

function countingStub(record: { count: number; keys: string[] }): AnthropicCallFn {
  return async (req) => {
    record.count += 1;
    record.keys.push(req.idempotency_key);
    const kind = req.idempotency_key.split(":").at(-2) ?? "";
    let text: string;
    if (kind === "draft" || kind === "revise" || kind === "visual_revise") {
      text = "<section><h1>Post draft</h1><p>Body copy.</p></section>";
    } else if (kind === "self_critique") {
      text = "- Tighten intro\n- Add CTA";
    } else {
      text = "(stub)";
    }
    const resp: AnthropicResponse = {
      id: `post-${record.count}`,
      model: req.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    return resp;
  };
}

async function seedCommittedPostBrief(siteId: string): Promise<{
  briefId: string;
  runId: string;
  postPageId: string;
}> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `post-mode-test ${unique}`,
      status: "committed",
      content_type: "post",
      source_storage_path: `post-mode/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `post-mode-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "c".repeat(64),
      brand_voice: "Warm, direct.",
      design_direction: "Editorial.",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`post seed brief: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  const page = await svc
    .from("brief_pages")
    .insert({
      brief_id: briefId,
      ordinal: 0,
      title: "First post",
      mode: "full_text",
      source_text: "Full post body copy.",
      word_count: 4,
    })
    .select("id")
    .single();
  if (page.error || !page.data) {
    throw new Error(`post seed page: ${page.error?.message}`);
  }

  const run = await svc
    .from("brief_runs")
    .insert({ brief_id: briefId, status: "queued" })
    .select("id")
    .single();
  if (run.error || !run.data) {
    throw new Error(`post seed run: ${run.error?.message}`);
  }

  return {
    briefId,
    runId: run.data.id as string,
    postPageId: page.data.id as string,
  };
}

describe("mode='post' — anchor cycles disabled", () => {
  it("fires only the standard 3-pass text loop (no anchor extra cycles)", async () => {
    const site = await seedSite();
    const { runId, postPageId, briefId } = await seedCommittedPostBrief(site.id);

    const rec = { count: 0, keys: [] as string[] };
    const result = await processBriefRunTick(runId, {
      anthropicCall: countingStub(rec),
      workerId: "post-mode-worker",
      // Stub the render so Playwright isn't required in CI. The visual
      // critique is still billed (one Anthropic call per iteration) but
      // we're only counting TEXT passes in the assertion, so the visual
      // spend doesn't skew the test.
      visualRender: (async () => ({
        viewport_png_base64: "UE5HLXN0dWI=",
        full_page_png_base64: "UE5HLXN0dWI=",
        viewport_bytes: 64,
        full_page_bytes: 64,
      })) satisfies VisualRenderFn,
    });
    expect(result.ok).toBe(true);

    // Count text passes only (visual critique passes have kind
    // 'visual_critique' or 'visual_revise' in the idempotency key).
    const textPasses = rec.keys.filter((k) => {
      const kind = k.split(":").at(-2) ?? "";
      return kind === "draft" || kind === "self_critique" || kind === "revise";
    });
    expect(textPasses.length).toBe(3);
    // Explicit: no revise:1, revise:2 from an anchor cycle
    expect(rec.keys.some((k) => k.endsWith(":revise:1"))).toBe(false);
    expect(rec.keys.some((k) => k.endsWith(":revise:2"))).toBe(false);

    // No site_conventions row was frozen — posts don't anchor.
    const svc = getServiceRoleClient();
    const conv = await svc
      .from("site_conventions")
      .select("id, frozen_at")
      .eq("brief_id", briefId)
      .maybeSingle();
    expect(conv.data).toBeNull();

    // Page ends up in awaiting_review like a page brief would.
    const pg = await svc
      .from("brief_pages")
      .select("page_status")
      .eq("id", postPageId)
      .single();
    expect(pg.data?.page_status).toBe("awaiting_review");
  });
});
