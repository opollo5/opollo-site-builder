import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getQstashClient } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

import {
  postImportPlatformFor,
  type BundleSocialPostImportPlatform,
} from "./platform-map";

// ---------------------------------------------------------------------------
// Post-history import — triggered on a fresh social-account connect.
//
// Flow:
//   1. enqueuePostHistoryImport({ profileId, bundleSocialAccountId,
//      platform }) — inserts a queued row in social_post_history_imports.
//      The active-dedup partial unique index (migration 0121) absorbs
//      duplicate inserts from the connect-callback + webhook arriving
//      in the same second. Posts a QStash job to call back at
//      /api/webhooks/qstash/social-post-history-import.
//
//   2. runPostHistoryImport({ importRowId }) — invoked by QStash. Calls
//      bundle.social's postImportCreate, polls postImportGetById every
//      ~30s, and on success fetches the imported posts via
//      postImportGetImportedPosts and seeds them into
//      social_post_analytics_snapshots dated today.
//
// 15-minute timeout budget: the QStash callback is allowed up to
// MAX_POLL_MS to complete. Vercel function limits cap each invocation
// at 800s for paid plans (we cap at maxDuration=300 to stay well under),
// so the runner exits cleanly with status='timeout' if bundle.social
// hasn't completed by then. The dashboard's "Re-run import" affordance
// re-enqueues a fresh import.
//
// Platform support: bundle.social's postImport endpoints don't cover X
// or Google Business. enqueuePostHistoryImport returns ok:true with a
// "skipped" reason when the platform isn't supported — the caller
// (connect callback) treats that as a no-op.
// ---------------------------------------------------------------------------

const IMPORT_COUNT = 50;
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_MS = 14 * 60 * 1000; // 14 min — under Vercel's hard limit

export type EnqueueImportResult =
  | { kind: "queued"; importRowId: string; reEnqueued: boolean }
  | { kind: "skipped"; reason: string }
  | { kind: "already_active"; importRowId: string };

export async function enqueuePostHistoryImport(input: {
  profileId: string;
  bundleSocialAccountId: string;
  platform: SocialPlatform;
  origin: string; // e.g. https://app.opollo.com
}): Promise<EnqueueImportResult> {
  const bundlePlatform = postImportPlatformFor(input.platform);
  if (!bundlePlatform) {
    return {
      kind: "skipped",
      reason: `Platform ${input.platform} is not supported by bundle.social postImport`,
    };
  }

  const svc = getServiceRoleClient();

  // Try-insert keyed on the partial unique index. ON CONFLICT DO NOTHING
  // absorbs the race.
  const insert = await svc
    .from("social_post_history_imports")
    .insert({
      profile_id: input.profileId,
      bundle_social_account_id: input.bundleSocialAccountId,
      platform: input.platform,
      status: "queued",
    })
    .select("id")
    .maybeSingle();

  let importRowId: string;
  let reEnqueued = false;

  if (insert.error) {
    if (insert.error.code === "23505") {
      // An active import already exists — find it.
      const existing = await svc
        .from("social_post_history_imports")
        .select("id, status")
        .eq("profile_id", input.profileId)
        .eq("bundle_social_account_id", input.bundleSocialAccountId)
        .in("status", ["queued", "running", "succeeded"])
        .maybeSingle();
      if (existing.error || !existing.data) {
        throw new Error(
          `enqueuePostHistoryImport dedup lookup failed: ${existing.error?.message ?? "row missing"}`,
        );
      }
      return {
        kind: "already_active",
        importRowId: existing.data.id as string,
      };
    }
    throw new Error(
      `enqueuePostHistoryImport insert failed: ${insert.error.message}`,
    );
  }

  importRowId = insert.data!.id as string;

  // Enqueue the QStash job.
  const client = getQstashClient();
  if (!client) {
    logger.info("social.analytics.post_history_import.no_qstash", {
      import_row_id: importRowId,
    });
    return { kind: "queued", importRowId, reEnqueued };
  }

  const callbackUrl = `${input.origin.replace(/\/+$/, "")}/api/webhooks/qstash/social-post-history-import`;
  try {
    await client.publishJSON({
      url: callbackUrl,
      body: { importRowId },
      // Idempotent across re-enqueues for the same import row.
      deduplicationId: `social-post-history-import-${importRowId}`,
    });
    reEnqueued = true;
  } catch (err) {
    logger.error("social.analytics.post_history_import.qstash_failed", {
      err: err instanceof Error ? err.message : String(err),
      import_row_id: importRowId,
    });
    // Don't fail the call — the row exists; operator can retry the
    // import manually from the dashboard.
  }

  return { kind: "queued", importRowId, reEnqueued };
}

export type RunOutcome =
  | { kind: "succeeded"; postsImported: number }
  | { kind: "failed"; error: string }
  | { kind: "timeout" }
  | { kind: "skipped"; reason: string };

export async function runPostHistoryImport(input: {
  importRowId: string;
}): Promise<RunOutcome> {
  const svc = getServiceRoleClient();
  const client = getBundlesocialClient();
  if (!client) {
    await markImport({
      svc,
      importRowId: input.importRowId,
      status: "failed",
      error: "BUNDLE_SOCIAL_API not configured",
    });
    return { kind: "failed", error: "BUNDLE_SOCIAL_API not configured" };
  }

  const { data: row, error: readErr } = await svc
    .from("social_post_history_imports")
    .select(
      "id, profile_id, bundle_social_account_id, platform, status, bundle_import_id",
    )
    .eq("id", input.importRowId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`Import row read failed: ${readErr.message}`);
  }
  if (!row) {
    return { kind: "skipped", reason: "Import row missing" };
  }
  if (row.status === "succeeded" || row.status === "failed") {
    return { kind: "skipped", reason: `Already ${row.status}` };
  }

  // Resolve the team id from the profile.
  const { data: profile, error: profErr } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", row.profile_id as string)
    .maybeSingle();

  if (profErr) {
    throw new Error(`Profile read failed: ${profErr.message}`);
  }
  if (!profile?.bundle_social_team_id) {
    await markImport({
      svc,
      importRowId: input.importRowId,
      status: "failed",
      error: "Profile not provisioned",
    });
    return { kind: "failed", error: "Profile not provisioned" };
  }

  const teamId = profile.bundle_social_team_id as string;
  const internalPlatform = row.platform as SocialPlatform;
  const bundlePlatform = postImportPlatformFor(internalPlatform);
  if (!bundlePlatform) {
    await markImport({
      svc,
      importRowId: input.importRowId,
      status: "failed",
      error: `Platform ${internalPlatform} not supported by bundle.social postImport`,
    });
    return {
      kind: "failed",
      error: `Platform ${internalPlatform} not supported`,
    };
  }

  await svc
    .from("social_post_history_imports")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", input.importRowId);

  // Start or resume the bundle.social import.
  let bundleImportId = row.bundle_import_id as string | null;
  if (!bundleImportId) {
    try {
      const created = await client.postImport.postImportCreate({
        requestBody: {
          teamId,
          socialAccountType: bundlePlatform,
          count: IMPORT_COUNT,
          withAnalytics: true,
          importCarousels: true,
        },
      });
      bundleImportId = created.id;
      await svc
        .from("social_post_history_imports")
        .update({ bundle_import_id: bundleImportId })
        .eq("id", input.importRowId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markImport({
        svc,
        importRowId: input.importRowId,
        status: "failed",
        error: msg,
      });
      return { kind: "failed", error: msg };
    }
  }

  // Poll bundle.social until terminal or timeout.
  const startedAt = Date.now();
  let lastStatus = "PENDING";
  while (Date.now() - startedAt < MAX_POLL_MS) {
    try {
      const status = await client.postImport.postImportGetById({
        importId: bundleImportId,
      });
      lastStatus = status.status;
      if (status.status === "COMPLETED") {
        const seeded = await seedImportedPosts({
          client,
          svc,
          profileId: row.profile_id as string,
          internalPlatform,
          bundlePlatform,
          teamId,
          bundleSocialAccountId: row.bundle_social_account_id as string,
        });
        await markImport({
          svc,
          importRowId: input.importRowId,
          status: "succeeded",
          posts_imported: seeded.posts_imported,
        });
        return { kind: "succeeded", postsImported: seeded.posts_imported };
      }
      if (status.status === "FAILED" || status.status === "RATE_LIMITED") {
        const msg =
          status.error ?? `bundle.social import status=${status.status}`;
        await markImport({
          svc,
          importRowId: input.importRowId,
          status: "failed",
          error: msg,
        });
        return { kind: "failed", error: msg };
      }
    } catch (err) {
      // Transient — swallow and retry on next tick.
      logger.warn("social.analytics.post_history_import.poll_failed", {
        err: err instanceof Error ? err.message : String(err),
        import_row_id: input.importRowId,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await markImport({
    svc,
    importRowId: input.importRowId,
    status: "timeout",
    error: `Polling exceeded ${MAX_POLL_MS / 1000}s (last status: ${lastStatus})`,
  });
  return { kind: "timeout" };
}

async function seedImportedPosts(args: {
  client: NonNullable<ReturnType<typeof getBundlesocialClient>>;
  svc: ReturnType<typeof getServiceRoleClient>;
  profileId: string;
  internalPlatform: SocialPlatform;
  bundlePlatform: BundleSocialPostImportPlatform;
  teamId: string;
  bundleSocialAccountId: string;
}): Promise<{ posts_imported: number }> {
  const list = await args.client.postImport.postImportGetImportedPosts({
    teamId: args.teamId,
    socialAccountType: args.bundlePlatform,
    limit: 200,
  });

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;

  for (const p of list.posts) {
    const a = p.analytics?.[0];
    const existing = await args.svc
      .from("social_post_analytics_snapshots")
      .select("id")
      .eq("profile_id", args.profileId)
      .eq("bundle_post_id", p.id)
      .eq("snapshot_date", today)
      .maybeSingle();

    if (existing.data?.id) continue;

    const mediaUrls = p.thumbnail ? [p.thumbnail] : [];
    const insert = await args.svc
      .from("social_post_analytics_snapshots")
      .insert({
        profile_id: args.profileId,
        bundle_post_id: p.id,
        platform: args.internalPlatform,
        bundle_social_account_id: args.bundleSocialAccountId,
        snapshot_date: today,
        posted_at: p.publishedAt ?? null,
        post_url: p.permalink ?? null,
        title: p.title ?? null,
        content: p.description ?? null,
        media_urls: mediaUrls.length > 0 ? mediaUrls : null,
        impressions: a?.impressions ?? null,
        impressions_unique: a?.impressionsUnique ?? null,
        views: a?.views ?? null,
        views_unique: a?.viewsUnique ?? null,
        likes: a?.likes ?? null,
        dislikes: a?.dislikes ?? null,
        comments: a?.comments ?? null,
        shares: a?.shares ?? null,
        saves: a?.saves ?? null,
        raw: a as unknown as Record<string, unknown> | null,
      });
    if (!insert.error) inserted += 1;
  }

  return { posts_imported: inserted };
}

async function markImport(args: {
  svc: ReturnType<typeof getServiceRoleClient>;
  importRowId: string;
  status: "succeeded" | "failed" | "timeout";
  error?: string;
  posts_imported?: number;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    status: args.status,
    completed_at: new Date().toISOString(),
  };
  if (args.error !== undefined) patch.error_message = args.error;
  if (args.posts_imported !== undefined) patch.posts_imported = args.posts_imported;
  await args.svc
    .from("social_post_history_imports")
    .update(patch)
    .eq("id", args.importRowId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
