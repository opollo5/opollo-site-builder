import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { BundlesocialPlatformType } from "./identity";
import { dbPlatformToBundleType } from "./route-helpers";
import type { SocialPlatform } from "./types";

// ---------------------------------------------------------------------------
// Bundle.social ↔ social_connections reconciliation.
//
// Split-brain defense for the case where the two sides diverge:
//   - Ghost: bundle.social has an account, we don't. Customer hits
//     "this team already has a … account connected" with no way to
//     resolve via the UI. Fix: disconnect the bundle.social account.
//   - Phantom: we have a row, bundle.social doesn't. UI shows a
//     healthy connection that can't actually publish. Fix: mark the
//     row disconnected with a clear last_error.
//   - Mismatch: both sides have an account but different
//     external_account_id, external_user_id, or display_name. Fix:
//     re-sync from bundle.social.
//
// Used by:
//   * /api/admin/maintenance/reconcile-bundlesocial   (L2 surface)
//   * /api/platform/social/connections/connect        (L1 pre-flight)
//   * /api/platform/social/connections/[id]/disconnect (L4 verify)
// ---------------------------------------------------------------------------

// Full bundle.social platform enum — covers every platform a team
// might have an account for, not just the channel-selection subset.
export const ALL_BUNDLESOCIAL_PLATFORMS = [
  "TIKTOK",
  "YOUTUBE",
  "INSTAGRAM",
  "FACEBOOK",
  "TWITTER",
  "THREADS",
  "LINKEDIN",
  "PINTEREST",
  "REDDIT",
  "MASTODON",
  "DISCORD",
  "SLACK",
  "BLUESKY",
  "GOOGLE_BUSINESS",
] as const satisfies ReadonlyArray<BundlesocialPlatformType>;

export type DivergenceKind = "ghost" | "phantom" | "mismatch";

export type Divergence = {
  kind: DivergenceKind;
  team_id: string;
  platform: BundlesocialPlatformType;
  // Present for ghost / mismatch.
  bundle_account_id: string | null;
  bundle_external_id: string | null;
  bundle_display_name: string | null;
  // Present for phantom / mismatch.
  db_row_id: string | null;
  db_company_id: string | null;
  db_platform: SocialPlatform | null;
  db_display_name: string | null;
  db_external_account_id: string | null;
  // Free-text reason — populated when kind = "mismatch" with which
  // fields differ.
  reason: string;
};

export type ScanInput = {
  // When set, scan only the listed teams. Otherwise scan every team
  // that appears in platform_social_profiles or platform_companies.
  teamIds?: ReadonlyArray<string>;
  // When set, scan only the listed platforms. Otherwise scan every
  // platform in ALL_BUNDLESOCIAL_PLATFORMS. Useful for the L1 pre-flight
  // path which only cares about the platform the user just clicked.
  platforms?: ReadonlyArray<BundlesocialPlatformType>;
};

export type ScanResult = {
  divergences: Divergence[];
  scanned_teams: string[];
  scanned_platforms: BundlesocialPlatformType[];
  errors: Array<{
    team_id: string;
    platform: BundlesocialPlatformType;
    message: string;
  }>;
};

// Collect every team_id we have any record of: from per-profile teams
// (BSP-8 onwards) and from legacy company-level teams. De-duped.
async function collectKnownTeamIds(): Promise<string[]> {
  const svc = getServiceRoleClient();

  const profileRead = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  const companyRead = await svc
    .from("platform_companies")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);

  if (profileRead.error)
    throw new Error(`Failed to read profiles: ${profileRead.error.message}`);
  if (companyRead.error)
    throw new Error(`Failed to read companies: ${companyRead.error.message}`);

  const set = new Set<string>();
  for (const r of (profileRead.data ?? []) as Array<{
    bundle_social_team_id: string | null;
  }>) {
    if (r.bundle_social_team_id) set.add(r.bundle_social_team_id);
  }
  for (const r of (companyRead.data ?? []) as Array<{
    bundle_social_team_id: string | null;
  }>) {
    if (r.bundle_social_team_id) set.add(r.bundle_social_team_id);
  }
  return Array.from(set);
}

// bundle.social's socialAccountGetByType returns null / 400 / 404 when
// no account exists for the (team, type) pair. The 400 body is
// "Team does not have a <platform> account."; the 404 is a stricter
// variant. Both mean "no account" — collapse into null.
async function safeGetByType(
  teamId: string,
  platform: BundlesocialPlatformType,
): Promise<
  | {
      id: string;
      externalId: string | null;
      userId: string | null;
      displayName: string | null;
    }
  | null
> {
  const client = getBundlesocialClient();
  if (!client) throw new Error("BUNDLE_SOCIAL_API is not configured.");

  try {
    const r = (await client.socialAccount.socialAccountGetByType({
      teamId,
      type: platform,
    })) as {
      id?: string;
      externalId?: string | null;
      userId?: string | null;
      displayName?: string | null;
    } | null;
    if (!r || !r.id) return null;
    return {
      id: r.id,
      externalId: r.externalId ?? null,
      userId: r.userId ?? null,
      displayName: r.displayName ?? null,
    };
  } catch (err) {
    const e = err as { status?: number };
    if (e?.status === 400 || e?.status === 404) return null;
    throw err;
  }
}

// Scan every (team, platform) tuple and return divergences. Read-only.
// Apply is a separate step (`applyDivergence`).
export async function scanBundlesocialDivergences(
  input: ScanInput = {},
): Promise<ScanResult> {
  const svc = getServiceRoleClient();

  const teams =
    input.teamIds && input.teamIds.length > 0
      ? Array.from(new Set(input.teamIds))
      : await collectKnownTeamIds();
  const platforms = input.platforms ?? ALL_BUNDLESOCIAL_PLATFORMS;

  // DB index keyed by bundle_social_account_id. Also keep a separate
  // (team, platform) → row[] index so we can detect phantoms — rows
  // pointing at this team+platform where bundle.social returned null.
  const connRead = await svc
    .from("social_connections")
    .select(
      "id, bundle_social_account_id, company_id, platform, display_name, external_account_id, external_user_id, profile_id, status",
    );
  if (connRead.error)
    throw new Error(`Failed to read social_connections: ${connRead.error.message}`);

  const profileRead = await svc
    .from("platform_social_profiles")
    .select("id, bundle_social_team_id");
  if (profileRead.error)
    throw new Error(`Failed to read profiles: ${profileRead.error.message}`);
  const profileTeamById = new Map<string, string>();
  for (const p of (profileRead.data ?? []) as Array<{
    id: string;
    bundle_social_team_id: string | null;
  }>) {
    if (p.bundle_social_team_id)
      profileTeamById.set(p.id, p.bundle_social_team_id);
  }

  const companyRead = await svc
    .from("platform_companies")
    .select("id, bundle_social_team_id");
  if (companyRead.error)
    throw new Error(`Failed to read companies: ${companyRead.error.message}`);
  const companyTeamById = new Map<string, string>();
  for (const c of (companyRead.data ?? []) as Array<{
    id: string;
    bundle_social_team_id: string | null;
  }>) {
    if (c.bundle_social_team_id)
      companyTeamById.set(c.id, c.bundle_social_team_id);
  }

  type DbRow = {
    id: string;
    bundle_social_account_id: string;
    company_id: string;
    platform: SocialPlatform;
    display_name: string | null;
    external_account_id: string | null;
    external_user_id: string | null;
    profile_id: string | null;
    status: string;
  };
  const dbByAcctId = new Map<string, DbRow>();
  // Key by `${teamId}::${bundlePlatform}`. Active rows only (anything
  // that isn't 'disconnected' is a candidate phantom if BS shows null).
  const dbByTeamPlatform = new Map<string, DbRow[]>();
  for (const r of (connRead.data ?? []) as DbRow[]) {
    dbByAcctId.set(r.bundle_social_account_id, r);
    const bundlePlatform = dbPlatformToBundleType(r.platform);
    const teamForRow =
      (r.profile_id && profileTeamById.get(r.profile_id)) ||
      companyTeamById.get(r.company_id) ||
      null;
    if (teamForRow) {
      const key = `${teamForRow}::${bundlePlatform}`;
      const arr = dbByTeamPlatform.get(key) ?? [];
      arr.push(r);
      dbByTeamPlatform.set(key, arr);
    }
  }

  const divergences: Divergence[] = [];
  const errors: ScanResult["errors"] = [];

  for (const teamId of teams) {
    for (const platform of platforms) {
      let acct: Awaited<ReturnType<typeof safeGetByType>>;
      try {
        acct = await safeGetByType(teamId, platform);
      } catch (err) {
        errors.push({
          team_id: teamId,
          platform,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const key = `${teamId}::${platform}`;
      const dbRows = (dbByTeamPlatform.get(key) ?? []).filter(
        (r) => r.status !== "disconnected",
      );

      if (acct === null) {
        // BS has nothing. If DB has an active row for this (team, platform),
        // that's a phantom — emit a divergence for each active row.
        for (const row of dbRows) {
          divergences.push({
            kind: "phantom",
            team_id: teamId,
            platform,
            bundle_account_id: null,
            bundle_external_id: null,
            bundle_display_name: null,
            db_row_id: row.id,
            db_company_id: row.company_id,
            db_platform: row.platform,
            db_display_name: row.display_name,
            db_external_account_id: row.external_account_id,
            reason: "DB row has no bundle.social account on this team.",
          });
        }
        continue;
      }

      // BS has an account. Look for a matching DB row by account_id.
      const matched = dbByAcctId.get(acct.id);
      if (!matched) {
        // Ghost — BS has it, no DB row exists for this exact account id.
        divergences.push({
          kind: "ghost",
          team_id: teamId,
          platform,
          bundle_account_id: acct.id,
          bundle_external_id: acct.externalId,
          bundle_display_name: acct.displayName,
          db_row_id: null,
          db_company_id: null,
          db_platform: null,
          db_display_name: null,
          db_external_account_id: null,
          reason: "bundle.social has an account; no matching social_connections row.",
        });
        continue;
      }

      // Both sides have an entry. Look for mismatches.
      const reasons: string[] = [];
      if (
        acct.externalId !== null &&
        matched.external_account_id !== null &&
        acct.externalId !== matched.external_account_id
      ) {
        reasons.push(
          `external_account_id drift (bundle=${acct.externalId} db=${matched.external_account_id})`,
        );
      }
      if (
        acct.displayName !== null &&
        matched.display_name !== null &&
        acct.displayName !== matched.display_name
      ) {
        reasons.push(
          `display_name drift (bundle="${acct.displayName}" db="${matched.display_name}")`,
        );
      }
      if (reasons.length > 0) {
        divergences.push({
          kind: "mismatch",
          team_id: teamId,
          platform,
          bundle_account_id: acct.id,
          bundle_external_id: acct.externalId,
          bundle_display_name: acct.displayName,
          db_row_id: matched.id,
          db_company_id: matched.company_id,
          db_platform: matched.platform,
          db_display_name: matched.display_name,
          db_external_account_id: matched.external_account_id,
          reason: reasons.join("; "),
        });
      }
    }
  }

  return {
    divergences,
    scanned_teams: teams,
    scanned_platforms: Array.from(platforms),
    errors,
  };
}

export type ApplyDivergenceResult =
  | { ok: true; action: string; detail: string | null }
  | { ok: false; error: { code: string; message: string } };

// Apply the recommended fix for a single divergence.
//
//   ghost   → bundle.social.socialAccountDisconnect(team, platform)
//   phantom → UPDATE social_connections SET status='disconnected'
//   mismatch → UPDATE social_connections from bundle.social's identity
//
// Audits to platform_events.bundlesocial_reconcile_applied regardless
// of action so the maintenance log shows every action.
export async function applyDivergence(
  divergence: Divergence,
  actorId: string | null,
): Promise<ApplyDivergenceResult> {
  const svc = getServiceRoleClient();
  const client = getBundlesocialClient();
  if (!client) {
    return {
      ok: false,
      error: {
        code: "RECEIVER_NOT_CONFIGURED",
        message: "BUNDLE_SOCIAL_API is not configured.",
      },
    };
  }

  let action: string;
  let detail: string | null = null;

  try {
    if (divergence.kind === "ghost") {
      await client.socialAccount.socialAccountDisconnect({
        requestBody: {
          type: divergence.platform,
          teamId: divergence.team_id,
        },
      });
      action = "ghost_disconnected";
      detail = `bundle.social account ${divergence.bundle_account_id} disconnected.`;
    } else if (divergence.kind === "phantom") {
      if (!divergence.db_row_id) {
        return {
          ok: false,
          error: {
            code: "INVALID_DIVERGENCE",
            message: "phantom divergence missing db_row_id.",
          },
        };
      }
      const upd = await svc
        .from("social_connections")
        .update({
          status: "disconnected",
          disconnected_at: new Date().toISOString(),
          last_error: "Marked disconnected by reconcile — bundle.social has no matching account.",
        })
        .eq("id", divergence.db_row_id);
      if (upd.error) {
        return {
          ok: false,
          error: { code: "DB_UPDATE_FAILED", message: upd.error.message },
        };
      }
      action = "phantom_marked_disconnected";
      detail = `social_connections.id=${divergence.db_row_id} → status='disconnected'`;
    } else {
      // mismatch — re-sync identity fields from bundle.social.
      if (!divergence.db_row_id) {
        return {
          ok: false,
          error: {
            code: "INVALID_DIVERGENCE",
            message: "mismatch divergence missing db_row_id.",
          },
        };
      }
      const upd = await svc
        .from("social_connections")
        .update({
          external_account_id: divergence.bundle_external_id,
          display_name: divergence.bundle_display_name,
          last_health_check_at: new Date().toISOString(),
        })
        .eq("id", divergence.db_row_id);
      if (upd.error) {
        return {
          ok: false,
          error: { code: "DB_UPDATE_FAILED", message: upd.error.message },
        };
      }
      action = "mismatch_resynced";
      detail = `social_connections.id=${divergence.db_row_id} ← bundle.social identity`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("bundlesocial.reconcile.apply_failed", {
      kind: divergence.kind,
      team_id: divergence.team_id,
      platform: divergence.platform,
      err: message,
    });
    return {
      ok: false,
      error: { code: "APPLY_FAILED", message },
    };
  }

  // Audit (fire-and-forget — failure to audit doesn't roll back the fix).
  void (async () => {
    try {
      await svc.from("platform_events").insert({
        event_type: "bundlesocial_reconcile_applied",
        company_id: divergence.db_company_id,
        actor_id: actorId,
        entity_type: "social_connection",
        entity_id: divergence.db_row_id,
        payload: {
          kind: divergence.kind,
          team_id: divergence.team_id,
          platform: divergence.platform,
          bundle_account_id: divergence.bundle_account_id,
          action,
          detail,
          reason: divergence.reason,
        },
      });
    } catch (err) {
      logger.warn("bundlesocial.reconcile.audit_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return { ok: true, action, detail };
}

// ---------------------------------------------------------------------------
// L1 helper — pre-connect ghost check.
//
// Called from POST /api/platform/social/connections/connect right before
// the OAuth URL is generated. Two interesting outcomes:
//
//   kind="ghost_cleared" — BS had a ghost; we disconnected it. Caller
//     should proceed with the OAuth popup.
//
//   kind="db_match"     — BS has an account AND we have a matching DB
//     row. Caller should NOT open OAuth; instead surface the existing
//     connection to the user with a Disconnect button.
//
//   kind="clean"        — BS has no account for this (team, platform).
//     Proceed as normal.
//
//   kind="error"        — could not call bundle.social. Caller should
//     proceed anyway (defensive) — the connect step itself will surface
//     the underlying error.
// ---------------------------------------------------------------------------

export type PreConnectCheck =
  | { kind: "clean" }
  | { kind: "ghost_cleared"; bundle_account_id: string }
  | {
      kind: "db_match";
      existing_connection_id: string;
      existing_company_id: string;
      existing_display_name: string | null;
      bundle_account_id: string;
    }
  | { kind: "error"; message: string };

export async function preConnectGhostCheck(input: {
  teamId: string;
  platform: BundlesocialPlatformType;
  actorId: string | null;
}): Promise<PreConnectCheck> {
  let acct;
  try {
    acct = await safeGetByType(input.teamId, input.platform);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!acct) return { kind: "clean" };

  const svc = getServiceRoleClient();
  const match = await svc
    .from("social_connections")
    .select("id, company_id, display_name, status")
    .eq("bundle_social_account_id", acct.id)
    .maybeSingle();

  if (match.data) {
    const row = match.data as {
      id: string;
      company_id: string;
      display_name: string | null;
      status: string;
    };
    return {
      kind: "db_match",
      existing_connection_id: row.id,
      existing_company_id: row.company_id,
      existing_display_name: row.display_name,
      bundle_account_id: acct.id,
    };
  }

  // Ghost — apply the disconnect inline.
  const applied = await applyDivergence(
    {
      kind: "ghost",
      team_id: input.teamId,
      platform: input.platform,
      bundle_account_id: acct.id,
      bundle_external_id: acct.externalId,
      bundle_display_name: acct.displayName,
      db_row_id: null,
      db_company_id: null,
      db_platform: null,
      db_display_name: null,
      db_external_account_id: null,
      reason: "Detected at pre-connect; auto-disconnect before OAuth.",
    },
    input.actorId,
  );
  if (!applied.ok) {
    return {
      kind: "error",
      message: `Ghost detected but disconnect failed: ${applied.error.message}`,
    };
  }
  return { kind: "ghost_cleared", bundle_account_id: acct.id };
}

// ---------------------------------------------------------------------------
// L4 helper — verify a disconnect actually landed on bundle.social.
//
// Called after socialAccountDisconnect. Polls socialAccountGetByType up
// to N times with backoff. Returns true if BS confirms the account is
// gone, false otherwise.
//
// The caller uses the result to decide whether to DELETE the DB row
// (only when verified clean) — see /api/platform/social/connections/[id]/
// disconnect/route.ts.
// ---------------------------------------------------------------------------

export async function verifyBundlesocialDisconnect(input: {
  teamId: string;
  platform: BundlesocialPlatformType;
  // Defaults: 2s settle + one retry after 5s ⇒ ~7s wall-clock worst case.
  initialWaitMs?: number;
  retryWaitMs?: number;
  retries?: number;
}): Promise<{ clean: boolean; reason: string }> {
  const initialWaitMs = input.initialWaitMs ?? 2_000;
  const retryWaitMs = input.retryWaitMs ?? 5_000;
  const retries = input.retries ?? 1;

  await new Promise((r) => setTimeout(r, initialWaitMs));
  let attempt = 0;
  // attempt 0 is the initial verify; subsequent loops are retries.
  while (true) {
    let acct;
    try {
      acct = await safeGetByType(input.teamId, input.platform);
    } catch (err) {
      return {
        clean: false,
        reason: `verify probe errored: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!acct) return { clean: true, reason: "bundle.social shows no account." };

    if (attempt >= retries) {
      return {
        clean: false,
        reason: `bundle.social still has account ${acct.id} after ${attempt + 1} attempt(s).`,
      };
    }
    attempt += 1;
    await new Promise((r) => setTimeout(r, retryWaitMs));
    // Re-issue the SDK disconnect — sometimes BS' first ack lags and
    // the retry is what actually flushes.
    const client = getBundlesocialClient();
    if (!client) return { clean: false, reason: "client unavailable on retry" };
    try {
      await client.socialAccount.socialAccountDisconnect({
        requestBody: { type: input.platform, teamId: input.teamId },
      });
    } catch {
      // tolerate — verify on next loop iteration.
    }
  }
}
