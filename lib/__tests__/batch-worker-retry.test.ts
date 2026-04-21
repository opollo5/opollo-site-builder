import { describe, expect, it } from "vitest";

import { createBatchJob } from "@/lib/batch-jobs";
import {
  leaseNextPage,
  processSlotAnthropic,
  RETRY_BACKOFF_MS,
  RETRY_MAX_ATTEMPTS,
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
// M3-7 — Retry loop with budget cap.
//
// Pins:
//   1. Retryable publish failure under budget → slot 'pending',
//      retry_after set to now()+backoff, attempts carried over.
//   2. retry_after in the future → leaseNextPage skips the slot.
//   3. retry_after in the past → slot is leasable again.
//   4. After RETRY_MAX_ATTEMPTS (3) failures, slot → terminal 'failed'
//      + job.failed_count++, regardless of retryable flag.
//   5. Non-retryable error → terminal 'failed' immediately (no
//      deferral) even if budget remains.
//   6. Retry budget is exhausted only on failures that got to the
//      publish step; successful retries zero out the path.
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

async function seedSingleSlotBatch(): Promise<{
  jobId: string;
  slotId: string;
}> {
  const site = await seedSite({ prefix: "ls" });
  const templateId = await seedActiveTemplateForSite(site.id);
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: [{ inputs: { slug: "retry-target", title: "Retry" } }],
    idempotency_key: `retry-${Date.now()}-${Math.random()}`,
    created_by: null,
  });
  if (!res.ok) throw new Error(res.error.message);
  const svc = getServiceRoleClient();
  const { data: slots } = await svc
    .from("generation_job_pages")
    .select("id")
    .eq("job_id", res.data.job_id)
    .limit(1);
  return { jobId: res.data.job_id, slotId: slots![0]!.id as string };
}

const DESCRIPTIVE_META =
  "A descriptive meta summary of the page that is comfortably between fifty and one hundred sixty characters.";

const GATE_PASSING_HTML = [
  '<section class="ls-hero" data-ds-version="1">',
  '  <h1 class="ls-hero-title">Hello</h1>',
  '  <p class="ls-hero-body"><a href="/x">x</a></p>',
  '  <img src="/a.png" alt="d" class="ls-hero-image"/>',
  `  <meta name="description" content="${DESCRIPTIVE_META}"/>`,
  "</section>",
].join("\n");

function stubAnthropic(): AnthropicCallFn {
  return async (req) => ({
    id: `resp_${req.idempotency_key}`,
    model: req.model,
    content: [{ type: "text", text: GATE_PASSING_HTML }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

function stubWpFailing(opts: {
  code: string;
  retryable: boolean;
}): WpCallBundle {
  return {
    getBySlug: async () => ({ ok: true, found: null }),
    create: async () => ({
      ok: false,
      code: opts.code,
      message: `stubbed ${opts.code}`,
      retryable: opts.retryable,
    }),
    update: async () => ({ ok: true, wp_page_id: 0 }),
  };
}

function stubWpSucceeding(): WpCallBundle {
  return {
    getBySlug: async () => ({ ok: true, found: null }),
    create: async ({ slug }) => ({ ok: true, wp_page_id: 1234, slug }),
    update: async ({ wp_page_id }) => ({ ok: true, wp_page_id }),
  };
}

// ---------------------------------------------------------------------------
// Retryable failure under budget → defer with retry_after
// ---------------------------------------------------------------------------

describe("retry: retryable failure with budget", () => {
  it("sets state=pending and retry_after to now()+backoff", async () => {
    const { slotId } = await seedSingleSlotBatch();
    const leased = await leaseNextPage("retry-worker");
    if (!leased) throw new Error("lease failed");
    expect(leased.attempts).toBe(1);

    const before = Date.now();
    await processSlotAnthropic(leased.id, "retry-worker", {
      anthropicCall: stubAnthropic(),
      wp: stubWpFailing({ code: "WP_API_ERROR", retryable: true }),
    });

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select(
        "state, worker_id, lease_expires_at, retry_after, attempts, last_error_code",
      )
      .eq("id", slotId)
      .single();
    expect(slot?.state).toBe("pending");
    expect(slot?.worker_id).toBeNull();
    expect(slot?.lease_expires_at).toBeNull();
    expect(slot?.attempts).toBe(1);
    expect(slot?.last_error_code).toBe("WP_API_ERROR");

    const retryAt = new Date(slot!.retry_after as string).getTime();
    // Backoff for attempts=1 is 1s. Allow a ~500ms window for test lag.
    expect(retryAt).toBeGreaterThanOrEqual(before + RETRY_BACKOFF_MS[1]! - 500);
    expect(retryAt).toBeLessThan(before + RETRY_BACKOFF_MS[1]! + 2_000);

    // retry_scheduled event logged.
    const { data: events } = await svc
      .from("generation_events")
      .select("event, details")
      .eq("page_slot_id", slotId)
      .eq("event", "retry_scheduled");
    expect(events?.length).toBe(1);
    expect((events![0]!.details as { backoff_ms: number }).backoff_ms).toBe(
      RETRY_BACKOFF_MS[1],
    );
  });
});

// ---------------------------------------------------------------------------
// leaseNextPage respects retry_after
// ---------------------------------------------------------------------------

describe("leaseNextPage retry_after honoured", () => {
  it("skips a pending slot whose retry_after is in the future", async () => {
    const { slotId } = await seedSingleSlotBatch();
    const svc = getServiceRoleClient();
    await svc
      .from("generation_job_pages")
      .update({ retry_after: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", slotId);

    const leased = await leaseNextPage("future-worker");
    expect(leased).toBeNull();
  });

  it("picks up a pending slot whose retry_after has passed", async () => {
    const { slotId } = await seedSingleSlotBatch();
    const svc = getServiceRoleClient();
    await svc
      .from("generation_job_pages")
      .update({ retry_after: new Date(Date.now() - 5_000).toISOString() })
      .eq("id", slotId);

    const leased = await leaseNextPage("past-worker");
    expect(leased).not.toBeNull();
    expect(leased?.id).toBe(slotId);
  });
});

// ---------------------------------------------------------------------------
// Exhausting the retry budget → terminal
// ---------------------------------------------------------------------------

describe("retry: budget exhaustion", () => {
  it("marks the slot 'failed' on the Nth consecutive retryable failure", async () => {
    const { jobId, slotId } = await seedSingleSlotBatch();
    const svc = getServiceRoleClient();

    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      // Clear retry_after from prior iteration so the test doesn't
      // have to wait out the real backoff.
      await svc
        .from("generation_job_pages")
        .update({ retry_after: null })
        .eq("id", slotId);

      const leased = await leaseNextPage(`ex-worker-${attempt}`);
      expect(leased?.id).toBe(slotId);
      expect(leased?.attempts).toBe(attempt);

      await processSlotAnthropic(leased!.id, `ex-worker-${attempt}`, {
        anthropicCall: stubAnthropic(),
        wp: stubWpFailing({ code: "WP_API_ERROR", retryable: true }),
      });

      const { data: slot } = await svc
        .from("generation_job_pages")
        .select("state, attempts")
        .eq("id", slotId)
        .single();

      if (attempt < RETRY_MAX_ATTEMPTS) {
        expect(slot?.state).toBe("pending");
      } else {
        expect(slot?.state).toBe("failed");
      }
      expect(slot?.attempts).toBe(attempt);
    }

    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, failed_count")
      .eq("id", jobId)
      .single();
    expect(job?.failed_count).toBe(1);
    expect(job?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Non-retryable → terminal immediately
// ---------------------------------------------------------------------------

describe("retry: non-retryable is terminal immediately", () => {
  it("marks the slot 'failed' on first failure when code is non-retryable", async () => {
    const { jobId, slotId } = await seedSingleSlotBatch();

    const leased = await leaseNextPage("nonret-worker");
    if (!leased) throw new Error("lease failed");
    expect(leased.attempts).toBe(1);

    await processSlotAnthropic(leased.id, "nonret-worker", {
      anthropicCall: stubAnthropic(),
      // SLUG_CONFLICT is flagged non-retryable in publishSlot.
      wp: stubWpFailing({ code: "SLUG_CONFLICT", retryable: false }),
    });

    const svc = getServiceRoleClient();
    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, attempts, retry_after")
      .eq("id", slotId)
      .single();
    expect(slot?.state).toBe("failed");
    expect(slot?.attempts).toBe(1);
    expect(slot?.retry_after).toBeNull();

    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, failed_count")
      .eq("id", jobId)
      .single();
    expect(job?.failed_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Retry eventually succeeds → zero failed_count, job status 'succeeded'
// ---------------------------------------------------------------------------

describe("retry: eventual success", () => {
  it("first attempt fails retryably, second attempt succeeds → job 'succeeded'", async () => {
    const { jobId, slotId } = await seedSingleSlotBatch();
    const svc = getServiceRoleClient();

    // Attempt 1: retryable failure.
    const first = await leaseNextPage("eventual-1");
    if (!first) throw new Error("lease failed");
    await processSlotAnthropic(first.id, "eventual-1", {
      anthropicCall: stubAnthropic(),
      wp: stubWpFailing({ code: "WP_API_ERROR", retryable: true }),
    });

    // Fast-forward past retry_after so the next lease picks it up.
    await svc
      .from("generation_job_pages")
      .update({ retry_after: null })
      .eq("id", slotId);

    // Attempt 2: succeeds.
    const second = await leaseNextPage("eventual-2");
    if (!second) throw new Error("re-lease failed");
    expect(second.id).toBe(slotId);
    expect(second.attempts).toBe(2);
    await processSlotAnthropic(second.id, "eventual-2", {
      anthropicCall: stubAnthropic(),
      wp: stubWpSucceeding(),
    });

    const { data: slot } = await svc
      .from("generation_job_pages")
      .select("state, attempts, wp_page_id")
      .eq("id", slotId)
      .single();
    expect(slot?.state).toBe("succeeded");
    expect(slot?.attempts).toBe(2);
    expect(Number(slot?.wp_page_id)).toBe(1234);

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
