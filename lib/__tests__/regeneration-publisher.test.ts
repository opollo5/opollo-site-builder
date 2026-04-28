import { describe, expect, it, vi } from "vitest";

import {
  publishRegenJob,
  type WpGetByIdResult,
  type WpRegenCallBundle,
  type WpUpdateByIdResult,
} from "@/lib/regeneration-publisher";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M7-3 — regeneration publisher tests.
//
// The publisher is the write-safety-critical core of M7. Invariants
// pinned here:
//
//   1. Quality gates run first. Fail → terminal failed_gates; no WP
//      side effects.
//   2. Partial-commit recovery. wp_put_succeeded in the event log →
//      skip WP work on retry, go straight to the pages commit.
//   3. Idempotent replay. pages_committed in the event log → just
//      flip status to succeeded (no re-running gates or WP calls).
//   4. Slug drift. Our slug ≠ WP slug → PUT body includes `slug`.
//   5. VERSION_CONFLICT on the pages UPDATE terminates the job; no
//      retry (new regen job snapshots the new version).
//   6. Image transfer wiring. `wp.media` set + CF URLs in HTML →
//      transferImagesForPage runs + HTML is rewritten.
//   7. WP PUT failure terminates the stage with retryable flag
//      matching the WP call's shape.
// ---------------------------------------------------------------------------

// Path-B fragment (PB-5, 2026-04-29). Top-level <section data-opollo>
// with site prefix + ds version, one <h1>, no empty hrefs, one
// <img alt="…">. No <meta> — host theme owns it; PR #194 dropped
// gateMetaDescription from ALL_GATES.
function passingHtml(prefix: string, dsv: string): string {
  return [
    `<section data-opollo class="${prefix}-scope" data-ds-version="${dsv}">`,
    `<h1 class="${prefix}-title">Regenerated</h1>`,
    `<p class="${prefix}-body"><a href="/help" class="${prefix}-link">Help</a></p>`,
    `<img class="${prefix}-img" src="https://imagedelivery.net/HASH/cf-abc/public" alt="Preview image"/>`,
    `</section>`,
  ].join("");
}

async function seedPage(
  siteId: string,
  opts: { slug?: string; wp_page_id?: number; version_lock?: number } = {},
): Promise<{ id: string; slug: string; wp_page_id: number }> {
  const svc = getServiceRoleClient();
  const slug = opts.slug ?? "regen-page";
  const wp_page_id = opts.wp_page_id ?? 4242;
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id,
      slug,
      title: `Page ${slug}`,
      page_type: "homepage",
      design_system_version: 1,
      status: "published",
      version_lock: opts.version_lock ?? 1,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return { id: data.id as string, slug, wp_page_id };
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
      status: "running",
      expected_page_version: opts.expectedVersion ?? 1,
      anthropic_idempotency_key: `anth-${pageId}-fixed`,
      wp_idempotency_key: `wp-${pageId}-fixed`,
      worker_id: "worker-test",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`seedRegenJob: ${error?.message ?? "no row"}`);
  return data.id as string;
}

function buildWpStub(overrides: {
  wpSlug?: string;
  resultingSlug?: string;
  wpPageId?: number;
  getFails?: WpGetByIdResult;
  putFails?: WpUpdateByIdResult;
} = {}): WpRegenCallBundle {
  const getByWpPageId = vi.fn(
    async (wp_page_id: number): Promise<WpGetByIdResult> => {
      if (overrides.getFails) return overrides.getFails;
      return {
        ok: true,
        found: {
          wp_page_id,
          slug: overrides.wpSlug ?? "regen-page",
          title: "Page regen-page",
          status: "publish",
          modified: new Date().toISOString(),
        },
      };
    },
  );
  const updateByWpPageId = vi.fn(
    async (input: {
      wp_page_id: number;
      content: string;
      slug?: string;
      title?: string;
      idempotency_key: string;
    }): Promise<WpUpdateByIdResult> => {
      if (overrides.putFails) return overrides.putFails;
      return {
        ok: true,
        wp_page_id: overrides.wpPageId ?? input.wp_page_id,
        resulting_slug:
          overrides.resultingSlug ?? input.slug ?? (overrides.wpSlug ?? "regen-page"),
      };
    },
  );
  return { getByWpPageId, updateByWpPageId };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("publishRegenJob — happy path", () => {
  it("runs gates → WP PUT → commits to pages → terminal succeeded", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73a" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub();

    const html = passingHtml(prefix, "1");
    const result = await publishRegenJob(jobId, html, wp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drift_detected).toBe(false);
    expect(result.resulting_slug).toBe(page.slug);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, finished_at")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("succeeded");
    expect(job?.finished_at).not.toBeNull();

    const { data: pageRow } = await svc
      .from("pages")
      .select("generated_html, version_lock")
      .eq("id", page.id)
      .maybeSingle();
    expect(pageRow?.generated_html).toBe(html);
    expect(Number(pageRow?.version_lock)).toBe(2);

    const { data: events } = await svc
      .from("regeneration_events")
      .select("type")
      .eq("regeneration_job_id", jobId);
    const types = (events ?? []).map((e) => e.type);
    expect(types).toContain("wp_put_succeeded");
    expect(types).toContain("pages_committed");
  });

  it("threads the stored wp_idempotency_key into every PUT", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73b" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub();
    await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);

    const updateFn = wp.updateByWpPageId as unknown as ReturnType<typeof vi.fn>;
    const call = updateFn.mock.calls[0]?.[0] as { idempotency_key: string };
    expect(call.idempotency_key).toBe(`wp-${page.id}-fixed`);
  });
});

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------

describe("publishRegenJob — quality gates", () => {
  it("fails with GATES_FAILED + terminal failed_gates when a gate rejects", async () => {
    const { id: siteId } = await seedSite({ prefix: "m73c" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub();

    // HTML missing the wrapper's data-ds-version → wrapper gate fails.
    const badHtml = `<div class="m73c-scope"><h1>Hi</h1></div>`;
    const result = await publishRegenJob(jobId, badHtml, wp);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("GATES_FAILED");
    expect(result.retryable).toBe(false);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status, failure_code, quality_gate_failures")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("failed_gates");
    expect(job?.failure_code).toMatch(/^GATE_/);
    expect(job?.quality_gate_failures).not.toBeNull();

    // WP was never called.
    const getFn = wp.getByWpPageId as unknown as ReturnType<typeof vi.fn>;
    expect(getFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drift reconciliation
// ---------------------------------------------------------------------------

describe("publishRegenJob — slug drift reconciliation", () => {
  it("detects drift and sends the new slug in the WP PUT body", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73d" });
    // Our DB has the new slug; WP still has the old one.
    const page = await seedPage(siteId, { slug: "new-slug" });
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub({ wpSlug: "old-slug", resultingSlug: "new-slug" });

    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drift_detected).toBe(true);
    expect(result.resulting_slug).toBe("new-slug");

    const updateFn = wp.updateByWpPageId as unknown as ReturnType<typeof vi.fn>;
    const call = updateFn.mock.calls[0]?.[0] as { slug?: string };
    expect(call.slug).toBe("new-slug");
  });

  it("omits slug from the PUT body when no drift", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73e" });
    const page = await seedPage(siteId, { slug: "aligned-slug" });
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub({ wpSlug: "aligned-slug" });

    await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    const updateFn = wp.updateByWpPageId as unknown as ReturnType<typeof vi.fn>;
    const call = updateFn.mock.calls[0]?.[0] as { slug?: string };
    expect(call.slug).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Partial-commit recovery
// ---------------------------------------------------------------------------

describe("publishRegenJob — partial-commit recovery", () => {
  it("skips WP calls when wp_put_succeeded is already in the event log", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73f" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);

    const svc = getServiceRoleClient();
    await svc.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "wp_put_succeeded",
      payload: {
        wp_page_id: page.wp_page_id,
        resulting_slug: page.slug,
        drift_detected: false,
        final_html_bytes: 500,
      },
    });

    const wp = buildWpStub();
    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adopted_from_event).toBe(true);

    const getFn = wp.getByWpPageId as unknown as ReturnType<typeof vi.fn>;
    const putFn = wp.updateByWpPageId as unknown as ReturnType<typeof vi.fn>;
    expect(getFn).not.toHaveBeenCalled();
    expect(putFn).not.toHaveBeenCalled();

    const { data: pageRow } = await svc
      .from("pages")
      .select("version_lock")
      .eq("id", page.id)
      .maybeSingle();
    expect(Number(pageRow?.version_lock)).toBe(2);
  });

  it("short-circuits to succeeded when pages_committed already exists", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73g" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);

    const svc = getServiceRoleClient();
    await svc.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "wp_put_succeeded",
      payload: {
        wp_page_id: page.wp_page_id,
        resulting_slug: page.slug,
        drift_detected: false,
      },
    });
    await svc.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "pages_committed",
      payload: { new_version_lock: 2 },
    });

    const wp = buildWpStub();
    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adopted_from_event).toBe(true);

    const getFn = wp.getByWpPageId as unknown as ReturnType<typeof vi.fn>;
    expect(getFn).not.toHaveBeenCalled();

    const { data: job } = await svc
      .from("regeneration_jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// VERSION_CONFLICT
// ---------------------------------------------------------------------------

describe("publishRegenJob — VERSION_CONFLICT", () => {
  it("fails terminal when pages.version_lock has moved since enqueue", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73h" });
    const page = await seedPage(siteId, { version_lock: 1 });
    const jobId = await seedRegenJob(siteId, page.id, { expectedVersion: 1 });

    // Concurrent M6-3 edit: bump version_lock between enqueue and now.
    const svc = getServiceRoleClient();
    await svc.from("pages").update({ version_lock: 2 }).eq("id", page.id);

    const wp = buildWpStub();
    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.retryable).toBe(false);

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
// WP failures
// ---------------------------------------------------------------------------

describe("publishRegenJob — WP failures", () => {
  it("surfaces WP_GET_FAILED with retryable flag from the stub", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73i" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub({
      getFails: {
        ok: false,
        code: "NETWORK_ERROR",
        message: "network unreachable",
        retryable: true,
      },
    });

    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WP_GET_FAILED");
    expect(result.retryable).toBe(true);
  });

  it("surfaces WP_PUT_FAILED and does NOT write the wp_put_succeeded event", async () => {
    const { id: siteId, prefix } = await seedSite({ prefix: "m73j" });
    const page = await seedPage(siteId);
    const jobId = await seedRegenJob(siteId, page.id);
    const wp = buildWpStub({
      putFails: {
        ok: false,
        code: "WP_API_ERROR",
        message: "500 Internal Server Error",
        retryable: true,
      },
    });

    const result = await publishRegenJob(jobId, passingHtml(prefix, "1"), wp);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WP_PUT_FAILED");

    const svc = getServiceRoleClient();
    const { data: events } = await svc
      .from("regeneration_events")
      .select("type")
      .eq("regeneration_job_id", jobId);
    const types = (events ?? []).map((e) => e.type);
    expect(types).not.toContain("wp_put_succeeded");
    expect(types).not.toContain("pages_committed");

    // pages row untouched.
    const { data: pageRow } = await svc
      .from("pages")
      .select("generated_html, version_lock")
      .eq("id", page.id)
      .maybeSingle();
    expect(pageRow?.generated_html).toBeNull();
    expect(Number(pageRow?.version_lock)).toBe(1);
  });
});
