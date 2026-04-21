import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  DEFAULT_REGEN_LEASE_MS,
  leaseNextRegenJob,
  processRegenJob,
  reapExpiredRegenLeases,
} from "@/lib/regeneration-worker";
import type {
  WpGetByIdResult,
  WpRegenCallBundle,
  WpUpdateByIdResult,
} from "@/lib/regeneration-publisher";
import { getSite } from "@/lib/sites";
import {
  wpGetPage,
  wpUpdatePage,
  type WpConfig,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/process-regenerations — M7-5.
//
// Entrypoint the Vercel cron tick calls to process one regeneration
// job per invocation. Mirrors /api/cron/process-batch (M3-3) but
// scoped to regeneration_jobs.
//
//   1. Reap any expired leases (resets them to pending).
//   2. Lease the next available job.
//   3. Build the WP call bundle from the site's credentials.
//   4. Run the full Anthropic → publisher pipeline via processRegenJob.
//   5. Return.
//
// One job per invocation on purpose — Vercel's 300s ceiling + multiple
// concurrent cron hits (one per job) lease disjoint rows via SKIP
// LOCKED and finish in parallel.
//
// Image transfer: wp.media is deliberately undefined in this bundle
// until the productionised M4-7 media client lands. The publisher
// gracefully skips image transfer + HTML rewrite when wp.media is
// absent (pages referencing Cloudflare URLs get shipped as-is). A
// follow-up slice will wire the real media bundle.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const filler = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, filler);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

function buildRegenBundle(cfg: WpConfig, sentSlug: string): WpRegenCallBundle {
  return {
    getByWpPageId: async (wp_page_id): Promise<WpGetByIdResult> => {
      const res = await wpGetPage(cfg, wp_page_id);
      if (!res.ok) {
        // wordpress.ts's error codes are a superset; map to the three
        // the publisher cares about. Network / rate-limit / 5xx are
        // retryable; 4xx is not.
        const retryable =
          res.code === "NETWORK_ERROR" ||
          res.code === "RATE_LIMIT" ||
          res.code === "WP_API_ERROR";
        return {
          ok: false,
          code:
            res.code === "AUTH_FAILED"
              ? "AUTH_FAILED"
              : res.code === "NETWORK_ERROR"
                ? "NETWORK_ERROR"
                : "WP_API_ERROR",
          message: res.message,
          retryable,
        };
      }
      return {
        ok: true,
        found: {
          wp_page_id: res.page_id,
          slug: res.slug,
          title: res.title,
          status: res.status,
          modified: res.modified_date,
        },
      };
    },
    updateByWpPageId: async (input): Promise<WpUpdateByIdResult> => {
      const res = await wpUpdatePage(cfg, input.wp_page_id, {
        title: input.title,
        content: input.content,
        slug: input.slug,
      });
      if (!res.ok) {
        const retryable =
          res.code === "NETWORK_ERROR" ||
          res.code === "RATE_LIMIT" ||
          res.code === "WP_API_ERROR";
        return {
          ok: false,
          code:
            res.code === "AUTH_FAILED"
              ? "AUTH_FAILED"
              : res.code === "NETWORK_ERROR"
                ? "NETWORK_ERROR"
                : "WP_API_ERROR",
          message: res.message,
          retryable,
        };
      }
      // wpUpdatePage returns page_id + status but not the resulting
      // slug in its current shape. Safe assumption: WP accepted
      // whatever we sent (we use a kebab-case regex at the API
      // boundary, which matches WP's post_name sanitisation). If WP
      // sanitises differently in practice, a follow-up can add a
      // wpGetPage round-trip to read the authoritative value.
      return {
        ok: true,
        wp_page_id: res.page_id,
        resulting_slug: input.slug ?? sentSlug,
      };
    },
    // wp.media intentionally omitted — see route docblock. Publisher
    // skips image transfer when undefined.
  };
}

async function runTick(): Promise<{
  reapedCount: number;
  processedJobId: string | null;
  outcome: "no-work" | "succeeded" | "failed" | "creds-missing";
}> {
  const { reapedCount } = await reapExpiredRegenLeases();

  const workerId = `regen-cron-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = await leaseNextRegenJob(workerId, {
    leaseDurationMs: DEFAULT_REGEN_LEASE_MS,
  });
  if (!job) {
    return { reapedCount, processedJobId: null, outcome: "no-work" };
  }

  // Load site + credentials. Failure here is terminal for the job
  // (credentials missing / decryption broken isn't something a retry
  // fixes). processRegenJob would fail noisily without a WP bundle.
  const siteRes = await getSite(job.site_id, { includeCredentials: true });
  if (!siteRes.ok || !siteRes.data.credentials) {
    // Mark the job terminal-failed so the next cron doesn't re-lease.
    const { getServiceRoleClient } = await import("@/lib/supabase");
    const svc = getServiceRoleClient();
    await svc
      .from("regeneration_jobs")
      .update({
        status: "failed",
        failure_code: "WP_CREDS_MISSING",
        failure_detail: siteRes.ok
          ? "Site has no decryptable WP credentials."
          : siteRes.error.message,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        worker_id: null,
        lease_expires_at: null,
      })
      .eq("id", job.id);
    return { reapedCount, processedJobId: job.id, outcome: "creds-missing" };
  }

  // Fetch the page's current slug so the bundle can return it on
  // update (see updateByWpPageId comment).
  const { getServiceRoleClient: getSvc } = await import("@/lib/supabase");
  const svc = getSvc();
  const pageRes = await svc
    .from("pages")
    .select("slug")
    .eq("id", job.page_id)
    .maybeSingle();
  const sentSlug = (pageRes.data?.slug as string) ?? "";

  const cfg: WpConfig = {
    baseUrl: siteRes.data.site.wp_url,
    user: siteRes.data.credentials.wp_user,
    appPassword: siteRes.data.credentials.wp_app_password,
  };
  const wp = buildRegenBundle(cfg, sentSlug);

  const result = await processRegenJob(job.id, { wp });
  return {
    reapedCount,
    processedJobId: job.id,
    outcome: result.ok ? "succeeded" : "failed",
  };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid cron secret.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 401 },
    );
  }

  try {
    const result = await runTick();
    return NextResponse.json(
      {
        ok: true,
        data: result,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `Cron tick failed: ${message}`,
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
