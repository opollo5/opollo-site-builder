import { describe, expect, it } from "vitest";

import type {
  AnthropicCallFn,
  AnthropicRequest,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import {
  processBriefRunTick,
  STANDARD_TEXT_PASSES,
} from "@/lib/brief-runner";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-3 brief-runner — happy path + resume-idempotency + pass-cap tests.
//
// Covers parent-plan risks:
//
//   R3  — Per-pass idempotency key is stable and deterministic. A retry
//         for the same (brief, ordinal, pass_kind, pass_number) replays
//         the SAME Anthropic key so the 24h server cache returns the
//         original response without double billing.
//
//   R10 — Hard pass cap per page. Non-anchor = STANDARD_TEXT_PASSES (3).
//         Anchor page = 3 + ANCHOR_EXTRA_CYCLES (2) = 5. The runner
//         MUST NOT loop beyond this on any input.
//
// Happy path verifies the per-page state machine drives
//   pending → generating → awaiting_review
// and pauses the run at awaiting_review (operator must approve).
// ---------------------------------------------------------------------------

type RecordedCall = Pick<AnthropicRequest, "idempotency_key" | "model">;

// Path-B fragments (PB-1, 2026-04-29). Each fixture is a contiguous
// fragment of <section data-opollo …> elements with no host chrome.
// Satisfies runFragmentStructuralCheck in lib/brief-runner.ts.
const DRAFT_OUTPUT =
  '<section data-opollo><h1>Hello</h1><p>Draft copy.</p></section>';
const CRITIQUE_OUTPUT = "- Make the headline punchier.";
const REVISE_OUTPUT =
  '<section data-opollo><h1>Punchier</h1><p>Revised copy.</p></section>';

function passTextFor(key: string): string {
  // Key shape: brief:<id>:p<ord>:<kind>:<num>
  if (key.includes(":self_critique:")) return CRITIQUE_OUTPUT;
  if (key.includes(":revise:")) return REVISE_OUTPUT;
  return DRAFT_OUTPUT;
}

function makeRunnerStub(record?: RecordedCall[]): AnthropicCallFn {
  let counter = 0;
  return async (req) => {
    counter += 1;
    if (record) {
      record.push({ idempotency_key: req.idempotency_key, model: req.model });
    }
    const text = passTextFor(req.idempotency_key);
    const resp: AnthropicResponse = {
      id: `resp_${counter}_${req.idempotency_key}`,
      model: req.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    return resp;
  };
}

async function seedCommittedBrief(opts: {
  siteId: string;
  pageOrdinals: number[];
}): Promise<{ briefId: string; pageIds: Record<number, string>; runId: string }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: opts.siteId,
      title: `runner-test ${unique}`,
      status: "committed",
      source_storage_path: `runner-test/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 256,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `runner-test-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "a".repeat(64),
      brand_voice: "Warm and direct.",
      design_direction: "Clean editorial with generous whitespace.",
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedCommittedBrief briefs: ${briefRes.error?.message}`);
  }
  const briefId = briefRes.data.id as string;

  const pageIds: Record<number, string> = {};
  for (const ord of opts.pageOrdinals) {
    const pr = await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId,
        ordinal: ord,
        title: `Page ${ord}`,
        mode: "full_text",
        source_text: `Content for page ${ord}.`,
        word_count: 4,
      })
      .select("id")
      .single();
    if (pr.error || !pr.data) {
      throw new Error(`seedCommittedBrief pages[${ord}]: ${pr.error?.message}`);
    }
    pageIds[ord] = pr.data.id as string;
  }

  const runRes = await svc
    .from("brief_runs")
    .insert({ brief_id: briefId, status: "queued" })
    .select("id")
    .single();
  if (runRes.error || !runRes.data) {
    throw new Error(`seedCommittedBrief runs: ${runRes.error?.message}`);
  }
  return { briefId, pageIds, runId: runRes.data.id as string };
}

describe("processBriefRunTick — happy path", () => {
  it("runs ordinal 0 (anchor) end-to-end and pauses at awaiting_review", async () => {
    const site = await seedSite();
    const { briefId, pageIds, runId } = await seedCommittedBrief({
      siteId: site.id,
      pageOrdinals: [0, 1],
    });

    const record: RecordedCall[] = [];
    const result = await processBriefRunTick(runId, {
      anthropicCall: makeRunnerStub(record),
      workerId: "happy-worker",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("page_advanced_to_review");
      expect(result.runStatus).toBe("paused");
      expect(result.currentOrdinal).toBe(0);
      expect(result.pageStatus).toBe("awaiting_review");
    }

    const svc = getServiceRoleClient();
    const pageAfter = await svc
      .from("brief_pages")
      .select("page_status, draft_html, current_pass_kind, current_pass_number, critique_log")
      .eq("id", pageIds[0]!)
      .single();
    expect(pageAfter.data?.page_status).toBe("awaiting_review");
    expect(pageAfter.data?.draft_html).toBeTruthy();
    // Critique log has one entry per pass executed.
    const log = pageAfter.data?.critique_log as Array<{ pass_kind: string }> | null;
    expect(log?.length).toBe(STANDARD_TEXT_PASSES + /*anchor extra*/ 2);

    const runAfter = await svc
      .from("brief_runs")
      .select("status, current_ordinal")
      .eq("id", runId)
      .single();
    expect(runAfter.data?.status).toBe("paused");
    expect(runAfter.data?.current_ordinal).toBe(0);

    // Brief id is used in the idempotency key — ensure keys reference it.
    for (const c of record) {
      expect(c.idempotency_key).toContain(`brief:${briefId}:p0:`);
    }
  });

  it("runs ordinal 1 (non-anchor) using exactly STANDARD_TEXT_PASSES passes", async () => {
    const site = await seedSite();
    const { briefId, pageIds, runId } = await seedCommittedBrief({
      siteId: site.id,
      pageOrdinals: [1], // no page 0: runner skips null gap, ends up processing 1
    });

    // Pre-populate ordinal 0 as already-approved by inserting it, then
    // marking it approved via the coherent-check-friendly column set.
    const svc = getServiceRoleClient();
    const page0 = await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId,
        ordinal: 0,
        title: "Page 0",
        mode: "full_text",
        source_text: "Anchor already done.",
        word_count: 3,
        draft_html: "<p>x</p>",
      })
      .select("id, version_lock")
      .single();
    if (page0.error || !page0.data) {
      throw new Error(`pre-approve ordinal 0: ${page0.error?.message}`);
    }
    await svc
      .from("brief_pages")
      .update({
        page_status: "approved",
        generated_html: "<p>approved-anchor</p>",
        approved_at: new Date().toISOString(),
        draft_html: "<p>approved-anchor</p>",
      })
      .eq("id", page0.data.id as string);

    const record: RecordedCall[] = [];
    const result = await processBriefRunTick(runId, {
      anthropicCall: makeRunnerStub(record),
      workerId: "happy-worker-non-anchor",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("page_advanced_to_review");
      expect(result.currentOrdinal).toBe(1);
    }

    // Non-anchor page ran exactly STANDARD_TEXT_PASSES (3) passes.
    expect(record.length).toBe(STANDARD_TEXT_PASSES);

    const pageAfter = await svc
      .from("brief_pages")
      .select("page_status, critique_log")
      .eq("id", pageIds[1]!)
      .single();
    expect(pageAfter.data?.page_status).toBe("awaiting_review");
    const log = pageAfter.data?.critique_log as Array<{
      pass_kind: string;
    }> | null;
    expect(log?.length).toBe(STANDARD_TEXT_PASSES);

    // Idempotency keys belong to ordinal 1 only.
    for (const c of record) {
      expect(c.idempotency_key).toContain(`brief:${briefId}:p1:`);
    }
  });
});

describe("processBriefRunTick — R3: per-pass idempotency key stability", () => {
  it("uses a deterministic idempotency key per (brief, ordinal, pass_kind, pass_number)", async () => {
    const site = await seedSite();
    const { briefId, runId } = await seedCommittedBrief({
      siteId: site.id,
      pageOrdinals: [0, 1],
    });

    const run1: RecordedCall[] = [];
    const res1 = await processBriefRunTick(runId, {
      anthropicCall: makeRunnerStub(run1),
      workerId: "key-stab-worker",
    });
    expect(res1.ok).toBe(true);

    const keys = run1.map((c) => c.idempotency_key);
    // The anchor page (p0) runs 5 passes: draft, self_critique, revise(0), revise(1), revise(2).
    expect(keys).toEqual([
      `brief:${briefId}:p0:draft:0`,
      `brief:${briefId}:p0:self_critique:0`,
      `brief:${briefId}:p0:revise:0`,
      `brief:${briefId}:p0:revise:1`,
      `brief:${briefId}:p0:revise:2`,
    ]);

    // Same keys MUST be produced if we replay from scratch against a
    // cleaned page. Since _setup's beforeEach truncates, we can't replay
    // mid-suite; instead we exercise determinism by calling against the
    // same brief id + ordinal + pass slots — the computed keys don't
    // depend on wallclock or counters, only on (brief_id, ordinal,
    // pass_kind, pass_number). The assertion above is the pinned
    // evidence of that determinism.
  });
});

describe("processBriefRunTick — R10: pass cap", () => {
  it("anchor page runs exactly STANDARD_TEXT_PASSES + ANCHOR_EXTRA_CYCLES passes", async () => {
    const site = await seedSite();
    const { runId } = await seedCommittedBrief({
      siteId: site.id,
      pageOrdinals: [0, 1],
    });

    const record: RecordedCall[] = [];
    await processBriefRunTick(runId, {
      anthropicCall: makeRunnerStub(record),
      workerId: "cap-worker",
    });

    // 3 standard + 2 extra revises = 5.
    expect(record.length).toBe(5);
    const passKinds = record.map((c) => {
      const m = c.idempotency_key.match(/:(draft|self_critique|revise):(\d+)$/);
      return m ? { kind: m[1], number: Number(m[2]) } : null;
    });
    expect(passKinds).toEqual([
      { kind: "draft", number: 0 },
      { kind: "self_critique", number: 0 },
      { kind: "revise", number: 0 },
      { kind: "revise", number: 1 },
      { kind: "revise", number: 2 },
    ]);
  });

  it("non-anchor page runs exactly STANDARD_TEXT_PASSES passes (no extra revise cycles)", async () => {
    const site = await seedSite();
    const { briefId, runId } = await seedCommittedBrief({
      siteId: site.id,
      pageOrdinals: [0, 1],
    });
    const svc = getServiceRoleClient();
    const page0Lookup = await svc
      .from("brief_pages")
      .select("id")
      .eq("brief_id", briefId)
      .eq("ordinal", 0)
      .single();
    await svc
      .from("brief_pages")
      .update({
        page_status: "approved",
        generated_html: "<p>ok</p>",
        approved_at: new Date().toISOString(),
        draft_html: "<p>ok</p>",
      })
      .eq("id", page0Lookup.data?.id as string);
    // Advance run to ordinal 1 so the tick goes straight to the
    // non-anchor page.
    await svc.from("brief_runs").update({ current_ordinal: 1 }).eq("id", runId);

    const record: RecordedCall[] = [];
    await processBriefRunTick(runId, {
      anthropicCall: makeRunnerStub(record),
      workerId: "cap-worker-2",
    });

    expect(record.length).toBe(STANDARD_TEXT_PASSES);
    expect(record.every((c) => c.idempotency_key.includes(":p1:"))).toBe(true);
    // No revise:1 or higher for a non-anchor page.
    expect(
      record.some(
        (c) => /:revise:[1-9]/.test(c.idempotency_key),
      ),
    ).toBe(false);
  });
});
