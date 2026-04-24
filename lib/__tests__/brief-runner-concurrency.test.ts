import { describe, expect, it } from "vitest";

import type {
  AnthropicCallFn,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import { processBriefRunTick } from "@/lib/brief-runner";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-3 — concurrency tests.
//
// Covers parent-plan risk R5: two workers race the same brief.
// The partial UNIQUE index `brief_runs_one_active_per_brief` is the
// load-bearing guard — only ONE brief_run per brief can hold a non-
// terminal status (queued / running / paused). A concurrent INSERT
// attempting a second active run raises 23505 (PostgreSQL
// unique_violation).
//
// This test pins that invariant AT THE DB LEVEL (not via the runner's
// lease primitives). If someone ever drops the index in a future
// migration, this test fails in CI.
//
// Also pins: two simultaneous ticks on the same brief_run row do not
// both succeed. leaseBriefRun's FOR UPDATE SKIP LOCKED serialises
// contention; the loser gets null.
// ---------------------------------------------------------------------------

function makeSilentStub(): AnthropicCallFn {
  let counter = 0;
  return async (req) => {
    counter += 1;
    const resp: AnthropicResponse = {
      id: `silent_${counter}`,
      model: req.model,
      content: [
        {
          type: "text",
          text: "<section><h1>Quiet</h1><p>Generated.</p></section>",
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    return resp;
  };
}

async function seedCommittedBrief(siteId: string): Promise<{ briefId: string }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const briefRes = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `runner-conc ${unique}`,
      status: "committed",
      source_storage_path: `runner-conc/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `runner-conc-${unique}`,
      committed_at: new Date().toISOString(),
      committed_page_hash: "c".repeat(64),
    })
    .select("id")
    .single();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`seedCommittedBrief: ${briefRes.error?.message}`);
  }
  return { briefId: briefRes.data.id as string };
}

describe("R5 — partial UNIQUE index on brief_runs enforces one active run per brief", () => {
  it("rejects a second queued/running/paused run with 23505", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBrief(site.id);
    const svc = getServiceRoleClient();

    const first = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    expect(first.error).toBeNull();
    expect(first.data?.id).toBeTruthy();

    const second = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" });
    expect(second.error).not.toBeNull();
    expect((second.error as { code?: string }).code).toBe("23505");
  });

  it("allows a second run once the first transitions to a terminal status", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBrief(site.id);
    const svc = getServiceRoleClient();

    const first = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    expect(first.error).toBeNull();

    // Drive the first run to succeeded (terminal) to release the partial
    // UNIQUE slot.
    await svc
      .from("brief_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", first.data!.id as string);

    const second = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    expect(second.error).toBeNull();
    expect(second.data?.id).toBeTruthy();
  });
});

describe("R5 — two workers ticking the same brief_run serialise", () => {
  it("one tick advances; the concurrent tick sees 'nothing_to_do' or 'lease_stolen'", async () => {
    const site = await seedSite();
    const { briefId } = await seedCommittedBrief(site.id);
    const svc = getServiceRoleClient();

    await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId,
        ordinal: 0,
        title: "Anchor",
        mode: "full_text",
        source_text: "Anchor.",
        word_count: 1,
      });
    const run = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    if (run.error || !run.data) {
      throw new Error(`seed run: ${run.error?.message}`);
    }
    const runId = run.data.id as string;

    const [a, b] = await Promise.all([
      processBriefRunTick(runId, {
        anthropicCall: makeSilentStub(),
        workerId: "worker-a",
      }),
      processBriefRunTick(runId, {
        anthropicCall: makeSilentStub(),
        workerId: "worker-b",
      }),
    ]);

    // At least one must have been ok; at most one may have advanced the
    // page. The loser returns ok:true with outcome "nothing_to_do"
    // because the other worker already leased the row.
    const okResults = [a, b].filter((r) => r.ok === true);
    expect(okResults.length).toBeGreaterThanOrEqual(1);

    const advancedCount = okResults.filter(
      (r) => r.ok === true && r.outcome === "page_advanced_to_review",
    ).length;
    expect(advancedCount).toBe(1);

    const pageAfter = await svc
      .from("brief_pages")
      .select("page_status")
      .eq("brief_id", briefId)
      .eq("ordinal", 0)
      .single();
    expect(pageAfter.data?.page_status).toBe("awaiting_review");
  });
});
