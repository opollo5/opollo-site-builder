import { describe, expect, it } from "vitest";

import type {
  AnthropicCallFn,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import { processBriefRunTick } from "@/lib/brief-runner";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-3 — anchor-cycle tests.
//
// Covers parent-plan risks:
//
//   R11 — Anchor page (ordinal 0) freezes site_conventions after its
//         final revise pass. Pages 1..N MUST read that frozen row and
//         inherit from it — the whole point of the anchor cycle is
//         locking voice+layout before fanning out.
//
//   R12 — Runner MUST halt at awaiting_review. Without operator
//         approval, the next tick MUST NOT advance to ordinal 1.
//         This is the pause-safety invariant from the parent plan
//         §Operator approval gate.
//
// The anchor's final revise pass is prompted to emit a ```json fenced
// block with the site_conventions payload. Our stub returns a
// deterministic fenced block so freezeSiteConventions receives a
// valid SiteConventionsSchema and persists a row with frozen_at set.
// ---------------------------------------------------------------------------

// Full-document shell — structural-completeness gate (2026-04-28).
const ANCHOR_REVISE_OUTPUT = `<!DOCTYPE html><html lang="en"><head><title>Anchor</title></head><body><section><h1>Anchor</h1><p>Final revision.</p></section></body></html>

\`\`\`json
{
  "typographic_scale": "clear-hierarchy",
  "section_rhythm": "alternating",
  "hero_pattern": "image-left",
  "tone_register": "warm-direct"
}
\`\`\``;

function makeAnchorStub(record: { last: string | null }): AnthropicCallFn {
  let counter = 0;
  return async (req) => {
    counter += 1;
    let text: string;
    if (req.idempotency_key.includes(":draft:")) {
      text =
        '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><section><h1>Draft</h1><p>First draft.</p></section></body></html>';
    } else if (req.idempotency_key.includes(":self_critique:")) {
      text = "- Tighten headline\n- Add CTA";
    } else if (req.idempotency_key.endsWith(":revise:2")) {
      // Final anchor revise — emit the json fenced block.
      text = ANCHOR_REVISE_OUTPUT;
    } else {
      text =
        '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><section><h1>Revised</h1><p>Intermediate revise.</p></section></body></html>';
    }
    record.last = req.idempotency_key;
    const resp: AnthropicResponse = {
      id: `anchor_${counter}`,
      model: req.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 200, output_tokens: 100 },
    };
    return resp;
  };
}

async function seedCommittedBrief(siteId: string): Promise<{
  briefId: string;
  runId: string;
  anchorPageId: string;
  nextPageId: string;
}> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `anchor-test ${unique}`,
      status: "committed",
      source_storage_path: `anchor-test/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 256,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `anchor-test-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "b".repeat(64),
      brand_voice: "Warm and direct.",
      design_direction: "Editorial.",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`anchor seed brief: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  const p0 = await svc
    .from("brief_pages")
    .insert({
      brief_id: briefId,
      ordinal: 0,
      title: "Anchor",
      mode: "full_text",
      source_text: "Anchor page content.",
      word_count: 3,
    })
    .select("id")
    .single();
  if (p0.error || !p0.data) {
    throw new Error(`anchor seed p0: ${p0.error?.message}`);
  }
  const p1 = await svc
    .from("brief_pages")
    .insert({
      brief_id: briefId,
      ordinal: 1,
      title: "Second",
      mode: "full_text",
      source_text: "Second page content.",
      word_count: 3,
    })
    .select("id")
    .single();
  if (p1.error || !p1.data) {
    throw new Error(`anchor seed p1: ${p1.error?.message}`);
  }

  const run = await svc
    .from("brief_runs")
    .insert({ brief_id: briefId, status: "queued" })
    .select("id")
    .single();
  if (run.error || !run.data) {
    throw new Error(`anchor seed run: ${run.error?.message}`);
  }
  return {
    briefId,
    runId: run.data.id as string,
    anchorPageId: p0.data.id as string,
    nextPageId: p1.data.id as string,
  };
}

describe("R11 — anchor cycle freezes site_conventions", () => {
  it("persists a site_conventions row with frozen_at set after the anchor page completes", async () => {
    const site = await seedSite();
    const { briefId, anchorPageId } = await seedCommittedBrief(site.id);

    const rec: { last: string | null } = { last: null };
    const { runId } = await (async () => {
      const svc = getServiceRoleClient();
      const r = await svc
        .from("brief_runs")
        .select("id")
        .eq("brief_id", briefId)
        .single();
      return { runId: r.data!.id as string };
    })();

    const result = await processBriefRunTick(runId, {
      anthropicCall: makeAnchorStub(rec),
      workerId: "anchor-worker",
    });
    expect(result.ok).toBe(true);

    const svc = getServiceRoleClient();
    const conv = await svc
      .from("site_conventions")
      .select("brief_id, frozen_at, typographic_scale, hero_pattern, tone_register")
      .eq("brief_id", briefId)
      .maybeSingle();
    expect(conv.error).toBeNull();
    expect(conv.data).not.toBeNull();
    expect(conv.data?.frozen_at).toBeTruthy();
    // Extracted values from the ANCHOR_REVISE_OUTPUT fenced block.
    expect(conv.data?.typographic_scale).toBe("clear-hierarchy");
    expect(conv.data?.hero_pattern).toBe("image-left");
    expect(conv.data?.tone_register).toBe("warm-direct");

    // Page 0 lands in awaiting_review (paused at the approval gate).
    const pg = await svc
      .from("brief_pages")
      .select("page_status")
      .eq("id", anchorPageId)
      .single();
    expect(pg.data?.page_status).toBe("awaiting_review");
  });
});

describe("R12 — runner halts at awaiting_review", () => {
  it("second tick does NOT advance ordinal 1 while ordinal 0 is awaiting_review", async () => {
    const site = await seedSite();
    const { briefId, anchorPageId, nextPageId, runId } =
      await seedCommittedBrief(site.id);

    const rec: { last: string | null } = { last: null };

    // Tick #1: process the anchor; it ends at awaiting_review + run paused.
    const first = await processBriefRunTick(runId, {
      anthropicCall: makeAnchorStub(rec),
      workerId: "halt-worker-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.outcome).toBe("page_advanced_to_review");
    }

    const svc = getServiceRoleClient();
    const page0Before = await svc
      .from("brief_pages")
      .select("page_status")
      .eq("id", anchorPageId)
      .single();
    expect(page0Before.data?.page_status).toBe("awaiting_review");

    const page1Before = await svc
      .from("brief_pages")
      .select("page_status, draft_html, current_pass_kind")
      .eq("id", nextPageId)
      .single();
    expect(page1Before.data?.page_status).toBe("pending");
    expect(page1Before.data?.draft_html).toBeNull();
    expect(page1Before.data?.current_pass_kind).toBeNull();

    // Re-queue the run so leaseBriefRun can claim it (paused → queued
    // happens naturally on approve; we simulate an admin retrying
    // without approving).
    await svc
      .from("brief_runs")
      .update({ status: "queued" })
      .eq("id", runId);

    // Tick #2: the runner MUST recognise ordinal 0 is awaiting_review
    // and refuse to advance, returning outcome "page_advanced_to_review"
    // (re-asserting the pause) with NO Anthropic calls made.
    const call2record: string[] = [];
    const second = await processBriefRunTick(runId, {
      anthropicCall: (async (req) => {
        call2record.push(req.idempotency_key);
        return {
          id: "should-not-happen",
          model: req.model,
          content: [{ type: "text" as const, text: "X" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }) as AnthropicCallFn,
      workerId: "halt-worker-2",
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.outcome).toBe("page_advanced_to_review");
      expect(second.currentOrdinal).toBe(0);
      expect(second.pageStatus).toBe("awaiting_review");
    }
    expect(call2record.length).toBe(0);

    // Page 1 untouched.
    const page1After = await svc
      .from("brief_pages")
      .select("page_status, draft_html, current_pass_kind")
      .eq("id", nextPageId)
      .single();
    expect(page1After.data?.page_status).toBe("pending");
    expect(page1After.data?.draft_html).toBeNull();
    expect(page1After.data?.current_pass_kind).toBeNull();
  });
});
