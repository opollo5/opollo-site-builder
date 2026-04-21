import { describe, expect, it } from "vitest";

import { createBatchJob } from "@/lib/batch-jobs";
import {
  leaseNextPage,
  processSlotAnthropic,
} from "@/lib/batch-worker";
import { createComponent } from "@/lib/components";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";
import { computeCostCents } from "@/lib/anthropic-pricing";
import type { AnthropicCallFn } from "@/lib/anthropic-call";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-4 — Anthropic processor tests.
//
// The three invariants this slice ships must hold:
//
//   1. Idempotency-Key stays stable across retries of the same slot.
//      The stub records the request; two runs with the same slot id
//      see the same key.
//
//   2. Event log is written BEFORE the slot's cost columns. If we
//      fail the UPDATE after writing the event, the billing facts
//      are still recoverable from generation_events — the reconciler
//      can rebuild slot cost from there.
//
//   3. Token reconciliation: sum of slot.cost_usd_cents across a
//      completed batch equals the sum derived from the event log's
//      anthropic_response_received rows.
// ---------------------------------------------------------------------------

async function seedActiveTemplateForSite(siteId: string): Promise<string> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(ds.error.message);
  for (const name of ["hero-centered", "footer-default"]) {
    const c = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0] ?? "misc",
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!c.ok) throw new Error(c.error.message);
  }
  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(t.error.message);
  const activated = await activateDesignSystem(ds.data.id, 1);
  if (!activated.ok) throw new Error(activated.error.message);
  return t.data.id;
}

async function seedSmallBatch(slots: number): Promise<string> {
  const site = await seedSite();
  const templateId = await seedActiveTemplateForSite(site.id);
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: Array.from({ length: slots }, (_, i) => ({
      inputs: { slug: `slug-${i}`, topic: `topic-${i}` },
    })),
    idempotency_key: `anth-${Date.now()}-${Math.random()}`,
    created_by: null,
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data.job_id;
}

type RecordedCall = {
  idempotency_key: string;
  model: string;
};

function makeStubCall(opts: {
  model?: string;
  text?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  record?: RecordedCall[];
}): AnthropicCallFn {
  let counter = 0;
  return async (req) => {
    counter += 1;
    if (opts.record) {
      opts.record.push({
        idempotency_key: req.idempotency_key,
        model: req.model,
      });
    }
    return {
      id: `resp_${req.idempotency_key}_${counter}`,
      model: opts.model ?? "claude-opus-4-7",
      content: [{ type: "text", text: opts.text ?? "<section>stub</section>" }],
      stop_reason: "end_turn",
      usage: opts.usage ?? {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Stable idempotency key across retries
// ---------------------------------------------------------------------------

describe("processSlotAnthropic — idempotency key stability", () => {
  it("calls Anthropic with the slot's anthropic_idempotency_key", async () => {
    await seedSmallBatch(1);
    const leased = await leaseNextPage("idem-worker");
    if (!leased) throw new Error("lease failed");

    const record: RecordedCall[] = [];
    await processSlotAnthropic(leased.id, "idem-worker", {
      anthropicCall: makeStubCall({ record }),
    });

    expect(record.length).toBe(1);
    expect(record[0]?.idempotency_key).toBe(leased.anthropic_idempotency_key);
  });

  it("re-processing the same slot (post-reaper) uses the same idempotency key", async () => {
    await seedSmallBatch(1);
    const leased = await leaseNextPage("worker-a");
    if (!leased) throw new Error("lease failed");

    // Simulate a crash mid-generation: force slot back to pending via reaper
    // state (worker_id cleared, state='pending') AFTER advancing to
    // generating. We bypass processSlotAnthropic's first transaction and
    // instead manually reset so the assertion focuses on key reuse.
    const svc = getServiceRoleClient();
    await svc
      .from("generation_job_pages")
      .update({
        state: "pending",
        worker_id: null,
        lease_expires_at: null,
      })
      .eq("id", leased.id);

    const reLeased = await leaseNextPage("worker-b");
    if (!reLeased || reLeased.id !== leased.id) {
      throw new Error("re-lease failed");
    }

    const record: RecordedCall[] = [];
    await processSlotAnthropic(reLeased.id, "worker-b", {
      anthropicCall: makeStubCall({ record }),
    });

    expect(record[0]?.idempotency_key).toBe(leased.anthropic_idempotency_key);
    // Original lease's key === re-lease's key because it's deterministic
    // on (job_id, slot_index).
    expect(reLeased.anthropic_idempotency_key).toBe(
      leased.anthropic_idempotency_key,
    );
  });
});

// ---------------------------------------------------------------------------
// Event-log-first ordering
// ---------------------------------------------------------------------------

describe("processSlotAnthropic — event log first", () => {
  it("writes anthropic_response_received with correct usage + cost before succeeding", async () => {
    const jobId = await seedSmallBatch(1);
    const leased = await leaseNextPage("ev-worker");
    if (!leased) throw new Error("lease failed");

    await processSlotAnthropic(leased.id, "ev-worker", {
      anthropicCall: makeStubCall({
        usage: {
          input_tokens: 2_000,
          output_tokens: 800,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      }),
    });

    const svc = getServiceRoleClient();
    const { data: events } = await svc
      .from("generation_events")
      .select("event, details, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    // Sequence: state_advanced→generating, anthropic_response_received,
    // state_advanced→succeeded. The anthropic event lands BEFORE the
    // final state_advanced one.
    const types = (events ?? []).map((e) => e.event as string);
    expect(types).toContain("anthropic_response_received");
    const anthropicIdx = types.indexOf("anthropic_response_received");
    const succeededIdx = types.lastIndexOf("state_advanced");
    expect(anthropicIdx).toBeGreaterThan(-1);
    expect(succeededIdx).toBeGreaterThan(anthropicIdx);

    const anthropicEvent = events?.[anthropicIdx];
    const details = anthropicEvent?.details as Record<string, unknown>;
    expect(details.input_tokens).toBe(2_000);
    expect(details.output_tokens).toBe(800);
    expect(details.cache_creation_input_tokens).toBe(100);
    expect(details.cache_read_input_tokens).toBe(50);
    expect(details.rate_found).toBe(true);
    expect(details.pricing_version).toBeDefined();
    expect(typeof details.cost_usd_cents).toBe("number");
    expect(details.cost_usd_cents as number).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Token reconciliation: slot totals == event-log totals
// ---------------------------------------------------------------------------

describe("processSlotAnthropic — token reconciliation", () => {
  it("slot cost sum equals the sum derived from the event log", async () => {
    const jobId = await seedSmallBatch(4);

    for (let i = 0; i < 4; i++) {
      const leased = await leaseNextPage(`rec-worker-${i}`);
      if (!leased) throw new Error("lease failed");
      await processSlotAnthropic(leased.id, `rec-worker-${i}`, {
        anthropicCall: makeStubCall({
          usage: {
            input_tokens: 500 * (i + 1),
            output_tokens: 200 * (i + 1),
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      });
    }

    const svc = getServiceRoleClient();
    const { data: slots } = await svc
      .from("generation_job_pages")
      .select("cost_usd_cents, state")
      .eq("job_id", jobId);
    const slotSum = (slots ?? []).reduce(
      (sum, s) => sum + Number(s.cost_usd_cents),
      0,
    );
    expect(slots?.every((s) => s.state === "succeeded")).toBe(true);

    const { data: events } = await svc
      .from("generation_events")
      .select("details")
      .eq("job_id", jobId)
      .eq("event", "anthropic_response_received");
    const eventSum = (events ?? []).reduce((sum, e) => {
      const d = e.details as Record<string, unknown>;
      return sum + (typeof d.cost_usd_cents === "number" ? d.cost_usd_cents : 0);
    }, 0);

    expect(slotSum).toBeGreaterThan(0);
    expect(slotSum).toBe(eventSum);

    // And the aggregated job total matches too.
    const { data: job } = await svc
      .from("generation_jobs")
      .select("total_cost_usd_cents, total_input_tokens, total_output_tokens")
      .eq("id", jobId)
      .single();
    expect(Number(job?.total_cost_usd_cents)).toBe(slotSum);
  });
});

// ---------------------------------------------------------------------------
// computeCostCents sanity
// ---------------------------------------------------------------------------

describe("computeCostCents", () => {
  it("returns rateFound=false for unknown models without throwing", () => {
    const r = computeCostCents("some-future-model", {
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(r.rateFound).toBe(false);
    expect(r.cents).toBe(0);
  });

  it("computes a positive cost for Opus 4.7 usage", () => {
    const r = computeCostCents("claude-opus-4-7", {
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(r.rateFound).toBe(true);
    expect(r.cents).toBeGreaterThan(0);
  });
});
