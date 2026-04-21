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
import type { AnthropicCallFn } from "@/lib/anthropic-call";
import type { WpCallBundle } from "@/lib/batch-publisher";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-6 — WP publish integration tests.
//
// Pins:
//   1. Happy path: gates pass + WP create → slot succeeded, pages row
//      linked, WP create called once with slug+title+content.
//   2. WP adoption (existing post by slug): GET returns found → PUT
//      update instead of POST create.
//   3. Pages-row adoption (previous attempt claimed slug but didn't
//      finish WP): slot re-runs, adopts existing pages row, WP create
//      still called once.
//   4. Pages-row adoption with WP already done (pages.wp_page_id > 0):
//      slot re-runs, skips WP create entirely, succeeds with the
//      pre-existing wp_page_id.
//   5. SLUG_CONFLICT: another job already owns the slug → slot
//      ends 'failed' with last_error_code='SLUG_CONFLICT', cost
//      recorded, job.failed_count++.
//   6. WP call error → slot 'failed' with the WP error code, cost
//      still recorded, job.failed_count++.
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
  opts: { slugBase?: string; prefix?: string } = {},
): Promise<{ jobId: string; siteId: string }> {
  const site = await seedSite({ prefix: opts.prefix ?? "ls" });
  const templateId = await seedActiveTemplateForSite(site.id);
  const slugBase = opts.slugBase ?? "post";
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: Array.from({ length: slots }, (_, i) => ({
      inputs: { slug: `${slugBase}-${i}`, title: `Title ${i}` },
    })),
    idempotency_key: `pub-${Date.now()}-${Math.random()}`,
    created_by: null,
  });
  if (!res.ok) throw new Error(res.error.message);
  return { jobId: res.data.job_id, siteId: site.id };
}

const DESCRIPTIVE_META =
  "A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters.";

const GATE_PASSING_HTML = [
  '<section class="ls-hero" data-ds-version="1">',
  '  <h1 class="ls-hero-title">Hello</h1>',
  '  <p class="ls-hero-body"><a href="/landing">link</a></p>',
  '  <img src="/a.png" alt="desc" class="ls-hero-image"/>',
  `  <meta name="description" content="${DESCRIPTIVE_META}"/>`,
  "</section>",
].join("\n");

function stubAnthropic(): AnthropicCallFn {
  return async (req) => ({
    id: `resp_${req.idempotency_key}`,
    model: req.model,
    content: [{ type: "text", text: GATE_PASSING_HTML }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 800,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
}

type WpCounters = {
  getBySlug: number;
  create: number;
  update: number;
};

function makeWp(opts: {
  counters?: WpCounters;
  getBySlugReturns?: {
    wp_page_id: number;
    status: string;
  } | null;
  createReturns?:
    | { ok: true; wp_page_id: number }
    | { ok: false; code: string; message: string; retryable: boolean };
  updateReturns?:
    | { ok: true }
    | { ok: false; code: string; message: string; retryable: boolean };
}): WpCallBundle {
  const counters = opts.counters ?? { getBySlug: 0, create: 0, update: 0 };
  return {
    getBySlug: async (_slug) => {
      counters.getBySlug += 1;
      return { ok: true, found: opts.getBySlugReturns ?? null };
    },
    create: async ({ slug }) => {
      counters.create += 1;
      if (!opts.createReturns || opts.createReturns.ok) {
        return {
          ok: true,
          wp_page_id:
            (opts.createReturns?.ok
              ? (opts.createReturns as { wp_page_id: number }).wp_page_id
              : undefined) ?? 1000 + counters.create,
          slug,
        };
      }
      const err = opts.createReturns;
      return {
        ok: false,
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      };
    },
    update: async ({ wp_page_id }) => {
      counters.update += 1;
      if (!opts.updateReturns || opts.updateReturns.ok) {
        return { ok: true, wp_page_id };
      }
      const err = opts.updateReturns;
      return {
        ok: false,
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("processSlotAnthropic + publishSlot — happy path", () => {
  it("publishes a fresh slug: POST to WP, pages row inserted, slot 'succeeded'", async () => {
    const { jobId } = await seedBatch(1);
    const leased = await leaseNextPage("pub-worker");
    if (!leased) throw new Error("lease failed");

    const counters = { getBySlug: 0, create: 0, update: 0 };
    const wp = makeWp({ counters });

    await processSlotAnthropic(leased.id, "pub-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    expect(counters.getBySlug).toBe(1);
    expect(counters.create).toBe(1);
    expect(counters.update).toBe(0);

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, pages_id, wp_page_id, cost_usd_cents")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(slot?.pages_id).not.toBeNull();
    expect(Number(slot?.wp_page_id)).toBeGreaterThan(0);
    expect(Number(slot?.cost_usd_cents)).toBeGreaterThan(0);

    const { data: pagesRow } = await svc
      .from("pages")
      .select("slug, wp_page_id, generated_html")
      .eq("id", slot!.pages_id as string)
      .single();
    expect(pagesRow?.slug).toBe("post-0");
    expect(Number(pagesRow?.wp_page_id)).toBe(Number(slot!.wp_page_id));
    expect(pagesRow?.generated_html).toContain("data-ds-version");

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

// ---------------------------------------------------------------------------
// WP adoption: existing post with the same slug
// ---------------------------------------------------------------------------

describe("WP adoption via GET-first", () => {
  it("updates the existing WP post instead of creating a duplicate", async () => {
    await seedBatch(1);
    const leased = await leaseNextPage("adopt-worker");
    if (!leased) throw new Error("lease failed");

    const counters = { getBySlug: 0, create: 0, update: 0 };
    const wp = makeWp({
      counters,
      getBySlugReturns: { wp_page_id: 4242, status: "publish" },
    });

    await processSlotAnthropic(leased.id, "adopt-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    expect(counters.create).toBe(0);
    expect(counters.update).toBe(1);

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, wp_page_id")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(Number(slot?.wp_page_id)).toBe(4242);
  });
});

// ---------------------------------------------------------------------------
// Pages-row adoption (previous attempt claimed slug, never finished WP)
// ---------------------------------------------------------------------------

describe("pages-row adoption", () => {
  it("adopts a prior attempt's pages row (wp_page_id=0, same job) and completes WP", async () => {
    const { siteId } = await seedBatch(1);
    const leased = await leaseNextPage("readopt-worker");
    if (!leased) throw new Error("lease failed");

    // Simulate a prior attempt: INSERT pages row with wp_page_id=0 +
    // link it to the slot. The publishSlot transaction should see
    // pages_id already set and proceed without another INSERT.
    const svc = getServiceRoleClient();
    const { data: inserted } = await svc
      .from("pages")
      .insert({
        site_id: siteId,
        wp_page_id: 0,
        slug: "post-0",
        title: "Title 0",
        page_type: "batch",
        design_system_version: 1,
        status: "draft",
      })
      .select("id")
      .single();
    const pagesId = inserted!.id as string;
    await svc
      .from("generation_job_pages")
      .update({ pages_id: pagesId })
      .eq("id", leased.id);

    const counters = { getBySlug: 0, create: 0, update: 0 };
    const wp = makeWp({ counters });

    await processSlotAnthropic(leased.id, "readopt-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    expect(counters.create).toBe(1);

    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, pages_id")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(slot?.pages_id).toBe(pagesId);

    const { data: pagesRow } = await svc
      .from("pages")
      .select("wp_page_id")
      .eq("id", pagesId)
      .single();
    expect(Number(pagesRow?.wp_page_id)).toBeGreaterThan(0);
  });

  it("skips the WP create entirely when pages.wp_page_id is already set", async () => {
    const { siteId } = await seedBatch(1);
    const leased = await leaseNextPage("skip-worker");
    if (!leased) throw new Error("lease failed");

    const svc = getServiceRoleClient();
    const { data: inserted } = await svc
      .from("pages")
      .insert({
        site_id: siteId,
        wp_page_id: 7777, // prior attempt already finished WP
        slug: "post-0",
        title: "Title 0",
        page_type: "batch",
        design_system_version: 1,
        status: "draft",
      })
      .select("id")
      .single();
    const pagesId = inserted!.id as string;
    await svc
      .from("generation_job_pages")
      .update({ pages_id: pagesId })
      .eq("id", leased.id);

    const counters = { getBySlug: 0, create: 0, update: 0 };
    const wp = makeWp({ counters });

    await processSlotAnthropic(leased.id, "skip-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    expect(counters.getBySlug).toBe(0);
    expect(counters.create).toBe(0);
    expect(counters.update).toBe(0);

    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, wp_page_id")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(Number(slot?.wp_page_id)).toBe(7777);
  });
});

// ---------------------------------------------------------------------------
// SLUG_CONFLICT: another job owns the slug
// ---------------------------------------------------------------------------

describe("SLUG_CONFLICT", () => {
  it("fails the slot with SLUG_CONFLICT when another job owns the slug", async () => {
    const { siteId, jobId } = await seedBatch(1, { slugBase: "taken" });

    // Seed a separate job that already owns slug 'taken-0' on this site.
    const templateId = await (async () => {
      const { data: existing } = await getServiceRoleClient()
        .from("design_templates")
        .select("id")
        .limit(1)
        .single();
      return existing!.id as string;
    })();
    const other = await createBatchJob({
      site_id: siteId,
      template_id: templateId,
      slots: [{ inputs: { slug: "taken-0" } }],
      idempotency_key: `otherjob-${Date.now()}`,
      created_by: null,
    });
    if (!other.ok) throw new Error(other.error.message);

    // Insert a pages row owned by that other job on slug 'taken-0'.
    const svc = getServiceRoleClient();
    const { data: otherSlots } = await svc
      .from("generation_job_pages")
      .select("id")
      .eq("job_id", other.data.job_id);
    const otherSlotId = otherSlots![0]!.id as string;
    const { data: pagesRow } = await svc
      .from("pages")
      .insert({
        site_id: siteId,
        wp_page_id: 5555,
        slug: "taken-0",
        title: "Other job's page",
        page_type: "batch",
        design_system_version: 1,
        status: "published",
      })
      .select("id")
      .single();
    await svc
      .from("generation_job_pages")
      .update({ pages_id: pagesRow!.id as string })
      .eq("id", otherSlotId);

    // Now run our slot. publishSlot should hit the unique violation
    // on pages.slug, see that the existing row is owned by other's
    // job, and return SLUG_CONFLICT.
    const leased = await leaseNextPage("conflict-worker");
    if (!leased) throw new Error("lease failed");

    const counters = { getBySlug: 0, create: 0, update: 0 };
    const wp = makeWp({ counters });
    await processSlotAnthropic(leased.id, "conflict-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    // No WP calls — we bailed before the WP step.
    expect(counters.create).toBe(0);
    expect(counters.update).toBe(0);

    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, last_error_code, cost_usd_cents")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("failed");
    expect(slot?.last_error_code).toBe("SLUG_CONFLICT");
    // Cost still recorded — we paid Anthropic before the publish attempt.
    expect(Number(slot?.cost_usd_cents)).toBeGreaterThan(0);

    const { data: ourJob } = await svc
      .from("generation_jobs")
      .select("failed_count, succeeded_count, status")
      .eq("id", jobId)
      .single();
    expect(ourJob?.failed_count).toBe(1);
    expect(ourJob?.succeeded_count).toBe(0);
    expect(ourJob?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// WP failure → slot 'failed', cost preserved
// ---------------------------------------------------------------------------

describe("WP failure path", () => {
  it("marks the slot 'failed' on WP create error, still records cost", async () => {
    const { jobId } = await seedBatch(1);
    const leased = await leaseNextPage("wpfail-worker");
    if (!leased) throw new Error("lease failed");

    const counters = { getBySlug: 0, create: 0, update: 0 };
    // retryable=false so the M3-7 retry loop short-circuits to
    // terminal-fail immediately. The retry-enabled behaviour is
    // pinned by batch-worker-retry.test.ts; this test stays focused
    // on the M3-6 cost-preservation + publish_failed-event
    // invariant.
    const wp = makeWp({
      counters,
      createReturns: {
        ok: false,
        code: "WP_API_NON_RETRYABLE",
        message: "400 Bad Request",
        retryable: false,
      },
    });

    await processSlotAnthropic(leased.id, "wpfail-worker", {
      anthropicCall: stubAnthropic(),
      wp,
    });

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, last_error_code, last_error_message, cost_usd_cents")
      .eq("id", leased.id)
      .single();
    expect(slot?.state).toBe("failed");
    expect(slot?.last_error_code).toBe("WP_API_NON_RETRYABLE");
    expect(slot?.last_error_message).toContain("400");
    expect(Number(slot?.cost_usd_cents)).toBeGreaterThan(0);

    const { data: events } = await svc
      .from("generation_events")
      .select("event")
      .eq("page_slot_id", leased.id);
    const types = (events ?? []).map((e) => e.event as string);
    expect(types).toContain("publish_failed");

    const { data: job } = await svc
      .from("generation_jobs")
      .select("failed_count, succeeded_count, status")
      .eq("id", jobId)
      .single();
    expect(job?.failed_count).toBe(1);
    expect(job?.status).toBe("failed");
  });
});
