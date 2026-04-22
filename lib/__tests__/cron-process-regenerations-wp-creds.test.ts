import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/cron/process-regenerations/route";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// WP_CREDS_MISSING terminal failure (M11-2 — closes audit gap #7).
//
// The cron route marks a leased job terminal-failed with
// failure_code='WP_CREDS_MISSING' when the site has no decryptable WP
// credentials row (either `getSite` failed with a site-level code, or
// the credentials column is null). Without the guard, processRegenJob
// would fail noisily and the job would retry forever.
//
// Pre-M11-2 the branch was implemented at
// app/api/cron/process-regenerations/route.ts:163 but had zero test
// coverage. This suite exercises the branch end-to-end by calling
// the real GET handler against a seeded site that has no wp_credentials
// row.
// ---------------------------------------------------------------------------

const VALID_CRON_SECRET = "test-cron-secret-min-16-chars-long";

async function seedRegenJobForSite(siteId: string): Promise<{
  jobId: string;
  pageId: string;
}> {
  const svc = getServiceRoleClient();

  const { data: page, error: pageErr } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug: "m11-wp-creds",
      title: "WP-creds-missing test",
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
      content_brief: { hero: { headline: "Placeholder" } },
    })
    .select("id")
    .single();
  if (pageErr || !page) {
    throw new Error(`seed page failed: ${pageErr?.message ?? "no row"}`);
  }

  const pageId = page.id as string;
  const { data: job, error: jobErr } = await svc
    .from("regeneration_jobs")
    .insert({
      site_id: siteId,
      page_id: pageId,
      status: "pending",
      expected_page_version: 1,
      anthropic_idempotency_key: `anth-${pageId}-m11`,
      wp_idempotency_key: `wp-${pageId}-m11`,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    throw new Error(`seed job failed: ${jobErr?.message ?? "no row"}`);
  }

  return { jobId: job.id as string, pageId };
}

function buildCronRequest(): Request {
  return new Request("http://localhost/api/cron/process-regenerations", {
    method: "GET",
    headers: { authorization: `Bearer ${VALID_CRON_SECRET}` },
  });
}

describe("cron/process-regenerations — WP_CREDS_MISSING branch", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = VALID_CRON_SECRET;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("marks the job failed with failure_code='WP_CREDS_MISSING' when the site has no credentials", async () => {
    const { id: siteId } = await seedSite({
      prefix: "m11b",
      name: "Regen WP-Creds-Missing",
    });
    // seedSite intentionally does NOT create a `site_wp_credentials`
    // row, so getSite({ includeCredentials: true }) returns a site
    // with credentials === null — which is exactly the branch we
    // want to exercise.
    const { jobId } = await seedRegenJobForSite(siteId);

    const req = buildCronRequest();
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      data: {
        processedJobId: string | null;
        outcome: string;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.processedJobId).toBe(jobId);
    expect(body.data.outcome).toBe("creds-missing");

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("regeneration_jobs")
      .select(
        "status, failure_code, failure_detail, worker_id, lease_expires_at, finished_at",
      )
      .eq("id", jobId)
      .maybeSingle();
    expect(job?.status).toBe("failed");
    expect(job?.failure_code).toBe("WP_CREDS_MISSING");
    expect(job?.failure_detail).toMatch(/credential/i);
    expect(job?.worker_id).toBeNull();
    expect(job?.lease_expires_at).toBeNull();
    expect(job?.finished_at).not.toBeNull();
  });
});
