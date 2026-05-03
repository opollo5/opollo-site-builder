import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-11 — quick-stats for the company landing dashboard.
//
// Six lightweight counts keyed off social_post_master.state. Each is a
// HEAD count (no body fetched) so the query is a constant ~1KB
// regardless of post volume.
//
// Why not a single SQL group-by? supabase-js lacks a clean GROUP BY
// surface; using a custom RPC for one dashboard read is overkill. Five
// HEAD counts in parallel is cheap and the SQL planner reuses the
// idx_post_master_company_state index for each.
//
// Caller is responsible for canDo("view_calendar", company_id). The
// landing-page server component already gates the whole surface;
// this lib trusts it.
// ---------------------------------------------------------------------------

export type SocialPostsStats = {
  drafts: number;
  awaitingApproval: number;
  approved: number;
  scheduled: number;
  published: number;
  // Subset of `approved`: state-flipped to approved within the last
  // 7 days (state_changed_at). Useful for the "approved this week"
  // tile.
  approvedThisWeek: number;
  changesRequested: number;
  failed: number;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function getSocialPostsStats(args: {
  companyId: string;
}): Promise<ApiResponse<SocialPostsStats>> {
  if (!args.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // Issue eight HEAD counts in parallel. Each query is index-friendly
  // (idx_post_master_company_state) and bounded by the company's
  // post volume.
  const counters = await Promise.all([
    countByState(svc, args.companyId, "draft"),
    countByState(svc, args.companyId, "pending_client_approval"),
    countByState(svc, args.companyId, "approved"),
    countByState(svc, args.companyId, "scheduled"),
    countByState(svc, args.companyId, "published"),
    countApprovedSince(svc, args.companyId, sevenDaysAgo),
    countByState(svc, args.companyId, "changes_requested"),
    countByState(svc, args.companyId, "failed"),
  ]);

  const errs = counters.filter((c) => c.error);
  if (errs.length > 0) {
    logger.error("social.posts.dashboard.stats_failed", {
      err: errs.map((e) => e.error).join("; "),
      company_id: args.companyId,
    });
    return internal(
      `Failed to read stats: ${errs.map((e) => e.error).join("; ")}`,
    );
  }

  const [drafts, awaiting, approved, scheduled, published, approvedRecent, changesReq, failed] =
    counters;

  return {
    ok: true,
    data: {
      drafts: drafts.count,
      awaitingApproval: awaiting.count,
      approved: approved.count,
      scheduled: scheduled.count,
      published: published.count,
      approvedThisWeek: approvedRecent.count,
      changesRequested: changesReq.count,
      failed: failed.count,
    },
    timestamp: new Date().toISOString(),
  };
}

type CountResult = { count: number; error: string | null };

async function countByState(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  state: string,
): Promise<CountResult> {
  const r = await svc
    .from("social_post_master")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("state", state);
  if (r.error) return { count: 0, error: r.error.message };
  return { count: r.count ?? 0, error: null };
}

async function countApprovedSince(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  isoTimestamp: string,
): Promise<CountResult> {
  const r = await svc
    .from("social_post_master")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("state", "approved")
    .gte("state_changed_at", isoTimestamp);
  if (r.error) return { count: 0, error: r.error.message };
  return { count: r.count ?? 0, error: null };
}

function validation(message: string): ApiResponse<SocialPostsStats> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<SocialPostsStats> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
