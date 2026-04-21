import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnthropicRequest, AnthropicResponse } from "@/lib/anthropic-call";
import {
  enqueueRegenJob,
  type WpRegenCallBundle,
} from "@/lib/regeneration-publisher";
import {
  leaseNextRegenJob,
  processRegenJob,
  REGEN_RETRY_MAX_ATTEMPTS,
} from "@/lib/regeneration-worker";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { createComponent } from "@/lib/components";
import { createTemplate } from "@/lib/templates";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M7-5 — retry/backoff + budget-cap tests.
//
// Pinned invariants:
//
//   1. Retryable failure + attempts < cap: job reset to pending with
//      retry_after set. leaseNextRegenJob excludes pending rows whose
//      retry_after is in the future.
//   2. Retryable failure + attempts >= cap: terminal failed.
//   3. Non-retryable failure: terminal immediately.
//   4. Enqueue rejected with BUDGET_EXCEEDED when today's regen cost
//      already hits REGEN_DAILY_BUDGET_CENTS.
// ---------------------------------------------------------------------------

async function seedActiveDsForSite(siteId: string): Promise<void> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(`seed ds: ${ds.error.message}`);
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
    if (!c.ok) throw new Error(`seed component: ${c.error.message}`);
  }
  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(`seed template: ${t.error.message}`);
  const activated = await activateDesignSystem(ds.data.id, ds.data.version_lock);
  if (!activated.ok)
    throw new Error(`activate ds: ${activated.error.message}`);
}

async function seedPage(siteId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug: "regen-retry",
      title: "Retry test",
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
      content_brief: { hero: { headline: "x" } },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return data.id as string;
}

async function seedRegenJob(
  siteId: string,
  pageId: string,
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("regeneration_jobs")
    .insert({
      site_id: siteId,
      page_id: pageId,
      status: "pending",
      expected_page_version: 1,
      anthropic_idempotency_key: `ant-${pageId}`,
      wp_idempotency_key: `wp-${pageId}`,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`seedRegenJob: ${error?.message ?? "no row"}`);
  return data.id as string;
}

function failingAnthropicStub() {
  return vi.fn(async () => {
    throw new Error("rate limit");
  });
}

function buildWpStub(): WpRegenCallBundle {
  return {
    getByWpPageId: vi.fn(async () => ({
      ok: false as const,
      code: "NETWORK_ERROR" as const,
      message: "unreachable",
      retryable: true,
    })),
    updateByWpPageId: vi.fn(async () => ({
      ok: false as const,
      code: "NETWORK_ERROR" as const,
      message: "unreachable",
      retryable: true,
    })),
  };
}

// ---------------------------------------------------------------------------
// Retry / defer
// ---------------------------------------------------------------------------

describe("processRegenJob — retry + defer", () => {
  it("defers to pending with retry_after when retryable + attempts < cap", async () => {
    const { id: siteId } = await seedSite({ prefix: "m75a" });
    await seedActiveDsForSite(siteId);
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);

    await leaseNextRegenJob("worker-test");

    const anthropic: ReturnType<typeof vi.fn> = failingAnthropicStub();
    const result = await processRegenJob(jobId, {
      anthropicCall: anthropic as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
      wp: buildWpStub(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.stage).toBe("anthropic");

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, worker_id, lease_expires_at, retry_after, failure_code")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("pending");
    expect(job?.worker_id).toBeNull();
    expect(job?.lease_expires_at).toBeNull();
    expect(job?.retry_after).not.toBeNull();
    expect(job?.failure_code).toBe("ANTHROPIC_FAILURE");

    const { data: events } = await svc
      .from("regeneration_events")
      .select("type")
      .eq("regeneration_job_id", jobId);
    const types = (events ?? []).map((e) => e.type);
    expect(types).toContain("retry_scheduled");
  });

  it("leaseNextRegenJob skips pending rows whose retry_after is in the future", async () => {
    const { id: siteId } = await seedSite({ prefix: "m75b" });
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);
    // Backdated created_at keeps ordering stable across this test.
    const svc = getServiceRoleClient();
    await svc
      .from("regeneration_jobs")
      .update({
        retry_after: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", jobId);

    const leased = await leaseNextRegenJob("worker-test");
    expect(leased).toBeNull();
  });

  it("terminal-fails when attempts equals REGEN_RETRY_MAX_ATTEMPTS", async () => {
    const { id: siteId } = await seedSite({ prefix: "m75c" });
    await seedActiveDsForSite(siteId);
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);

    const svc = getServiceRoleClient();
    // Advance attempts to just-below-the-cap manually so the next lease
    // bumps it to cap and the failure goes terminal.
    await svc
      .from("regeneration_jobs")
      .update({ attempts: REGEN_RETRY_MAX_ATTEMPTS - 1 })
      .eq("id", jobId);

    await leaseNextRegenJob("worker-test");

    const anthropic = failingAnthropicStub();
    const result = await processRegenJob(jobId, {
      anthropicCall: anthropic as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
      wp: buildWpStub(),
    });
    expect(result.ok).toBe(false);

    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, failure_code")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("failed");
    expect(job?.failure_code).toBe("ANTHROPIC_FAILURE");
  });
});

// ---------------------------------------------------------------------------
// Budget cap
// ---------------------------------------------------------------------------

describe("enqueueRegenJob — daily budget", () => {
  afterEach(() => {
    delete process.env.REGEN_DAILY_BUDGET_CENTS;
  });

  it("rejects with BUDGET_EXCEEDED when today's regen cost already meets the cap", async () => {
    process.env.REGEN_DAILY_BUDGET_CENTS = "100";

    const { id: siteId } = await seedSite({ prefix: "m75d" });
    const pageId = await seedPage(siteId);

    // Seed a completed regen today with cost at the cap.
    const svc = getServiceRoleClient();
    await svc.from("regeneration_jobs").insert({
      site_id: siteId,
      page_id: pageId,
      status: "succeeded",
      expected_page_version: 1,
      anthropic_idempotency_key: "ant-burn",
      wp_idempotency_key: "wp-burn",
      cost_usd_cents: 100,
      finished_at: new Date().toISOString(),
    });

    const result = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("BUDGET_EXCEEDED");
    expect(result.details?.cap_cents).toBe(100);
  });

  it("allows enqueue when today's regen cost is below the cap", async () => {
    process.env.REGEN_DAILY_BUDGET_CENTS = "100";
    const { id: siteId } = await seedSite({ prefix: "m75e" });
    const pageId = await seedPage(siteId);
    // Today's spend: 50c (below cap of 100c).
    const svc = getServiceRoleClient();
    await svc.from("regeneration_jobs").insert({
      site_id: siteId,
      page_id: pageId,
      status: "succeeded",
      expected_page_version: 1,
      anthropic_idempotency_key: "ant-half",
      wp_idempotency_key: "wp-half",
      cost_usd_cents: 50,
      finished_at: new Date().toISOString(),
    });

    const result = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(result.ok).toBe(true);
  });
});
