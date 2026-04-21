import { describe, expect, it } from "vitest";

import { createBatchJob } from "@/lib/batch-jobs";
import { leaseNextPage, processSlotAnthropic } from "@/lib/batch-worker";
import { createComponent } from "@/lib/components";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";
import type { AnthropicCallFn } from "@/lib/anthropic-call";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-5 — processSlotAnthropic with the gate runner wired in.
//
// Two integration cases:
//
//   1. Gates PASS with well-formed HTML → slot ends 'succeeded', job
//      succeeded_count ticks, cost recorded, state_advanced events
//      show generating → validating → succeeded.
//
//   2. Gates FAIL with ill-formed HTML → slot ends 'failed' with
//      last_error_code='QUALITY_GATE_FAILED', quality_gate_failures
//      populated, gate_failed event present, job failed_count ticks,
//      but cost STILL recorded because we paid Anthropic.
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

async function seedBatch(
  slots: number,
  slugHint: string | null = "hello-world",
): Promise<string> {
  const site = await seedSite({ prefix: "ls" });
  const templateId = await seedActiveTemplateForSite(site.id);
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: Array.from({ length: slots }, (_, i) => ({
      inputs: {
        slug: slugHint ? `${slugHint}-${i}` : undefined,
        topic: `topic-${i}`,
      },
    })),
    idempotency_key: `gate-${Date.now()}-${Math.random()}`,
    created_by: null,
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data.job_id;
}

function stubCallReturningHtml(html: string): AnthropicCallFn {
  return async (req) => ({
    id: `resp_${req.idempotency_key}`,
    model: req.model,
    content: [{ type: "text", text: html }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
}

const DESCRIPTIVE_META =
  "A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters.";

const VALID_HTML = `<section class="ls-hero" data-ds-version="1">
  <h1 class="ls-hero-title">Hello</h1>
  <p class="ls-hero-body">Body <a href="/landing">link</a></p>
  <img src="/a.png" alt="descriptive" class="ls-hero-image"/>
  <meta name="description" content="${DESCRIPTIVE_META}"/>
</section>`;

// Missing data-ds-version — wrapper gate fires first.
const WRAPPER_BROKEN_HTML = `<section class="ls-hero">
  <h1>Hello</h1>
  <p><a href="/x">link</a></p>
  <img src="/a.png" alt="x"/>
  <meta name="description" content="${DESCRIPTIVE_META}"/>
</section>`;

describe("processSlotAnthropic — gates pass", () => {
  it("walks generating → validating → succeeded and ticks succeeded_count", async () => {
    const jobId = await seedBatch(1);
    const leased = await leaseNextPage("pass-worker");
    if (!leased) throw new Error("lease failed");

    await processSlotAnthropic(leased.id, "pass-worker", {
      anthropicCall: stubCallReturningHtml(VALID_HTML),
    });

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select(
        "state, last_error_code, quality_gate_failures, cost_usd_cents, generated_html",
      )
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(slot?.last_error_code).toBeNull();
    expect(slot?.quality_gate_failures).toBeNull();
    expect(Number(slot?.cost_usd_cents)).toBeGreaterThan(0);
    expect(slot?.generated_html).toContain("data-ds-version");

    const { data: events } = await svc
      .from("generation_events")
      .select("event, details")
      .eq("page_slot_id", leased.id)
      .order("id", { ascending: true });
    const eventTypes = (events ?? []).map((e) => e.event);
    expect(eventTypes).toContain("anthropic_response_received");
    // Two state_advanced entries for validating + succeeded, plus the
    // earlier generating one.
    const stateTransitions = (events ?? [])
      .filter((e) => e.event === "state_advanced")
      .map((e) => (e.details as { to: string }).to);
    expect(stateTransitions).toEqual(["generating", "validating", "succeeded"]);

    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, succeeded_count, failed_count")
      .eq("id", jobId)
      .single();
    expect(job?.status).toBe("succeeded");
    expect(job?.succeeded_count).toBe(1);
    expect(job?.failed_count).toBe(0);
  });
});

describe("processSlotAnthropic — gate failure", () => {
  it("marks the slot failed at the first failing gate and still records cost", async () => {
    const jobId = await seedBatch(1);
    const leased = await leaseNextPage("fail-worker");
    if (!leased) throw new Error("lease failed");

    await processSlotAnthropic(leased.id, "fail-worker", {
      anthropicCall: stubCallReturningHtml(WRAPPER_BROKEN_HTML),
    });

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select(
        "state, last_error_code, last_error_message, quality_gate_failures, cost_usd_cents, input_tokens, output_tokens",
      )
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("failed");
    expect(slot?.last_error_code).toBe("QUALITY_GATE_FAILED");
    expect(slot?.last_error_message).toMatch(/wrapper/);
    const failures = slot?.quality_gate_failures as unknown as Array<{
      gate: string;
    }>;
    expect(Array.isArray(failures)).toBe(true);
    expect(failures[0]?.gate).toBe("wrapper");

    // Cost still recorded — we paid Anthropic before the gate ran.
    expect(Number(slot?.cost_usd_cents)).toBeGreaterThan(0);
    expect(Number(slot?.input_tokens)).toBeGreaterThan(0);
    expect(Number(slot?.output_tokens)).toBeGreaterThan(0);

    const { data: events } = await svc
      .from("generation_events")
      .select("event, details")
      .eq("page_slot_id", leased.id)
      .order("id", { ascending: true });
    const gateFailed = (events ?? []).find((e) => e.event === "gate_failed");
    expect(gateFailed).toBeTruthy();
    expect((gateFailed!.details as { gate: string }).gate).toBe("wrapper");

    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, succeeded_count, failed_count, total_cost_usd_cents")
      .eq("id", jobId)
      .single();
    expect(job?.failed_count).toBe(1);
    expect(job?.succeeded_count).toBe(0);
    // Last (and only) slot finished → whole job is 'failed' since
    // succeeded_count=0.
    expect(job?.status).toBe("failed");
    // Parent job cost accumulated even though the gate failed.
    expect(Number(job?.total_cost_usd_cents)).toBeGreaterThan(0);
  });
});
