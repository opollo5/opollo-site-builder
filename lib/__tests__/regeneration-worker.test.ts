import { describe, expect, it, vi } from "vitest";

import type { AnthropicRequest, AnthropicResponse } from "@/lib/anthropic-call";
import {
  DEFAULT_REGEN_LEASE_MS,
  heartbeatRegen,
  leaseNextRegenJob,
  processRegenJobAnthropic,
  reapExpiredRegenLeases,
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
// M7-2 — regeneration worker core tests.
//
// Three contracts get pinned here:
//
//   1. Anthropic-stage writes event log BEFORE the cost columns flip,
//      so partial-commit failures don't lose billing.
//   2. Idempotency key is threaded verbatim — a retry uses the same
//      key as the original attempt.
//   3. Lease / heartbeat / reaper primitives behave like their M3
//      counterparts.
//
// Plus VERSION_CONFLICT short-circuit (don't spend Anthropic on a
// doomed commit) + DS_ARCHIVED guard.
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

async function seedPage(
  siteId: string,
  slug: string = "regen-test",
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug,
      title: `Regen test ${slug}`,
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
      content_brief: { hero: { headline: "Original" } },
    })
    .select("id, version_lock")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return data.id as string;
}

async function seedRegenJob(
  siteId: string,
  pageId: string,
  opts: { expectedVersion?: number } = {},
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("regeneration_jobs")
    .insert({
      site_id: siteId,
      page_id: pageId,
      status: "pending",
      expected_page_version: opts.expectedVersion ?? 1,
      anthropic_idempotency_key: `anth-${pageId}-fixed`,
      wp_idempotency_key: `wp-${pageId}-fixed`,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`seedRegenJob: ${error?.message ?? "no row"}`);
  return data.id as string;
}

function buildStubResponse(overrides: Partial<AnthropicResponse> = {}): AnthropicResponse {
  return {
    id: "resp-stub-1",
    model: "claude-opus-4-7",
    content: [
      {
        type: "text",
        text: "<div class=\"ls-scope\"><h1>Regenerated HTML</h1></div>",
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Anthropic-stage happy path
// ---------------------------------------------------------------------------

describe("processRegenJobAnthropic — happy path", () => {
  it("writes event log, bumps cost columns, and leaves job 'running' for the publisher to pick up", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72a", name: "Regen Alpha" });
    await seedActiveDsForSite(siteId);
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);

    // Lease first so status is 'running' (the function assumes a leased job).
    const leased = await leaseNextRegenJob("worker-test");
    expect(leased?.id).toBe(jobId);

    const stub: ReturnType<typeof vi.fn> = vi.fn(async () => buildStubResponse());
    const result = await processRegenJobAnthropic(jobId, {
      anthropicCall: stub as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
    });
    expect(result.ok).toBe(true);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select(
        "status, cost_usd_cents, input_tokens, output_tokens, anthropic_raw_response_id",
      )
      .eq("id", jobId)
      .maybeSingle();
    // M7-3 refactor: Anthropic stage no longer terminal-succeeds.
    // The publisher (separate stage) flips status after pages commits.
    expect(job?.status).toBe("running");
    expect(Number(job?.input_tokens)).toBe(1000);
    expect(Number(job?.output_tokens)).toBe(500);
    expect(job?.anthropic_raw_response_id).toBe("resp-stub-1");
    expect(Number(job?.cost_usd_cents)).toBeGreaterThan(0);

    const { data: events } = await svc
      .from("regeneration_events")
      .select("type")
      .eq("regeneration_job_id", jobId)
      .order("created_at", { ascending: true });
    const types = (events ?? []).map((e) => e.type);
    expect(types).toContain("anthropic_response_received");
    // The M7-2 stub event is gone in M7-3.
    expect(types).not.toContain("m7_2_stub_succeeded");
  });

  it("threads the stored idempotency key verbatim into the Anthropic call", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72b", name: "Regen Bravo" });
    await seedActiveDsForSite(siteId);
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);
    await leaseNextRegenJob("worker-test");

    const stub: ReturnType<typeof vi.fn> = vi.fn(async () => buildStubResponse());
    await processRegenJobAnthropic(jobId, {
      anthropicCall: stub as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
    });
    const firstCall = stub.mock.calls[0]?.[0] as AnthropicRequest;
    expect(firstCall?.idempotency_key).toBe(`anth-${pageId}-fixed`);
  });
});

// ---------------------------------------------------------------------------
// VERSION_CONFLICT short-circuit
// ---------------------------------------------------------------------------

describe("processRegenJobAnthropic — VERSION_CONFLICT", () => {
  it("fails terminal BEFORE Anthropic call when page.version_lock has moved", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72c", name: "Regen Charlie" });
    await seedActiveDsForSite(siteId);
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId, { expectedVersion: 1 });
    await leaseNextRegenJob("worker-test");

    // Simulate a concurrent M6-3 metadata edit bumping version_lock.
    const svc = getServiceRoleClient();
    await svc
      .from("pages")
      .update({ version_lock: 2, updated_at: new Date().toISOString() })
      .eq("id", pageId);

    const stub: ReturnType<typeof vi.fn> = vi.fn(async () => buildStubResponse());
    const result = await processRegenJobAnthropic(jobId, {
      anthropicCall: stub as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(stub).not.toHaveBeenCalled();

    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, failure_code")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("failed");
    expect(job?.failure_code).toBe("VERSION_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// Lease primitives
// ---------------------------------------------------------------------------

describe("leaseNextRegenJob", () => {
  it("dequeues the oldest pending job and flips it to running", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72d", name: "Regen Delta" });
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);

    const leased = await leaseNextRegenJob("worker-a");
    expect(leased?.id).toBe(jobId);
    expect(leased?.anthropic_idempotency_key).toBe(`anth-${pageId}-fixed`);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, worker_id, attempts")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("running");
    expect(job?.worker_id).toBe("worker-a");
    expect(Number(job?.attempts)).toBe(1);
  });

  it("returns null when nothing is leasable", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72e", name: "Regen Echo" });
    await seedPage(siteId);
    // No jobs seeded.
    const leased = await leaseNextRegenJob("worker-a");
    expect(leased).toBeNull();
  });

  it("skips cancelled jobs", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72f", name: "Regen Foxtrot" });
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);
    const svc = getServiceRoleClient();
    await svc
      .from("regeneration_jobs")
      .update({ cancel_requested_at: new Date().toISOString() })
      .eq("id", jobId);

    const leased = await leaseNextRegenJob("worker-a");
    expect(leased).toBeNull();
  });
});

describe("heartbeatRegen", () => {
  it("extends the lease when the worker still owns it", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72g", name: "Regen Golf" });
    const pageId = await seedPage(siteId);
    await seedRegenJob(siteId, pageId);

    const leased = await leaseNextRegenJob("worker-a", {
      leaseDurationMs: 60_000,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    const beat = await heartbeatRegen(leased.id, "worker-a", {
      leaseDurationMs: 120_000,
    });
    expect(beat).toBe(true);
  });

  it("refuses to heartbeat when another worker holds the lease", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72h", name: "Regen Hotel" });
    const pageId = await seedPage(siteId);
    await seedRegenJob(siteId, pageId);
    const leased = await leaseNextRegenJob("worker-a");
    expect(leased).not.toBeNull();
    if (!leased) return;

    const beat = await heartbeatRegen(leased.id, "worker-thief");
    expect(beat).toBe(false);
  });
});

describe("reapExpiredRegenLeases", () => {
  it("resets running jobs with expired leases back to pending", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72i", name: "Regen India" });
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);

    // Lease it with a very short duration and force-expire.
    await leaseNextRegenJob("worker-a", { leaseDurationMs: 100 });
    const svc = getServiceRoleClient();
    await svc
      .from("regeneration_jobs")
      .update({
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", jobId);

    const reaped = await reapExpiredRegenLeases();
    expect(reaped.reapedCount).toBe(1);

    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, worker_id, lease_expires_at")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("pending");
    expect(job?.worker_id).toBeNull();
    expect(job?.lease_expires_at).toBeNull();
  });

  it("leaves non-expired running jobs untouched", async () => {
    const { id: siteId } = await seedSite({ prefix: "m72j", name: "Regen Juliet" });
    const pageId = await seedPage(siteId);
    await seedRegenJob(siteId, pageId);
    await leaseNextRegenJob("worker-a", { leaseDurationMs: DEFAULT_REGEN_LEASE_MS });

    const reaped = await reapExpiredRegenLeases();
    expect(reaped.reapedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DS_ARCHIVED terminal failure (M11-2 — closes audit gap #7).
//
// The branch exists in lib/regeneration-worker.ts: if
// `buildSystemPromptForSite` throws (design system for the page's
// recorded version is gone), the job is recorded terminal-failed with
// failure_code = 'DS_ARCHIVED' and the Anthropic call is never made.
// Pre-M11-2 the branch was implemented but had zero test coverage.
//
// Production's `buildSystemPromptForSite` falls back to legacy blocks
// rather than throwing under normal DB state, so the test uses the
// M11-2 `buildSystemPrompt` DI param to inject a stub that throws.
// ---------------------------------------------------------------------------

describe("processRegenJobAnthropic — DS_ARCHIVED", () => {
  it("records terminal failure with failure_code='DS_ARCHIVED' when the prompt builder throws", async () => {
    const { id: siteId } = await seedSite({
      prefix: "m11a",
      name: "Regen DS-Archived",
    });
    // No active DS is seeded; the default buildSystemPromptForSite
    // would have fallen back to legacy, so we inject a stub that
    // throws to mirror "DS version has been archived since enqueue."
    const pageId = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, pageId);
    await leaseNextRegenJob("worker-test");

    const anthropicStub: ReturnType<typeof vi.fn> = vi.fn(async () =>
      buildStubResponse(),
    );
    const promptStub = vi.fn(async () => {
      throw new Error(
        "Design system v1 has been archived; no active prompt block available.",
      );
    });

    const result = await processRegenJobAnthropic(jobId, {
      anthropicCall: anthropicStub as unknown as (
        req: AnthropicRequest,
      ) => Promise<AnthropicResponse>,
      buildSystemPrompt: promptStub,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("DS_ARCHIVED");
    expect(anthropicStub).not.toHaveBeenCalled();

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, failure_code, failure_detail, finished_at")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("failed");
    expect(job?.failure_code).toBe("DS_ARCHIVED");
    expect(job?.failure_detail).toMatch(/archived/i);
    expect(job?.finished_at).not.toBeNull();
  });
});
