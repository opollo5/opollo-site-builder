import { NextResponse, type NextRequest } from "next/server";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import {
  internalError,
  invalidState,
  notFound,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { unsetChannel } from "@/lib/platform/social/connections/channels";
import {
  CHANNEL_SELECTION_PLATFORMS,
} from "@/lib/platform/social/connections/identity";
import { verifyBundlesocialDisconnect } from "@/lib/platform/social/connections/reconcile";
import { loadConnectionWithTeam } from "@/lib/platform/social/connections/route-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/[id]/disconnect
//
// Layer 6 disconnect ordering: unset channel → settle (200ms) →
// socialAccountDisconnect → DELETE row → emit audit. The order
// matters because drafts referencing the old channel must be released
// before bundle.social tears down the account, otherwise they ghost-
// point at a dead connection (per bundle.social docs).
//
// Each upstream step tolerates failure independently and logs — the
// row-delete is the customer-visible "this is gone" moment, so it
// happens at the end of the chain even when the SDK calls error.
//
// Gate: canDo("manage_connections", company_id of the connection).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bundle.social's "Team does not have a <platform> account" 400 is the
// idempotent-success case — disconnecting an already-disconnected
// (team, type) returns 400 with this message. Tolerate it.
function isAlreadyDisconnected400(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; status?: number; body?: unknown };
  if (e.name !== "ApiError" || e.status !== 400) return false;
  const body = e.body;
  const message =
    body && typeof body === "object" && body !== null
      ? ((body as { message?: string }).message ?? "")
      : typeof body === "string"
        ? body
        : "";
  return /does not have/i.test(message);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const loaded = await loadConnectionWithTeam(idCheck.value);
  if (!loaded.ok) {
    if (loaded.error.code === "NOT_FOUND") return notFound(loaded.error.message);
    return invalidState(loaded.error.message);
  }
  const conn = loaded.data;

  const gate = await requireCanDoForApi(conn.company_id, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  const client = getBundlesocialClient();
  if (!client) return invalidState("BUNDLE_SOCIAL_API is not configured.");

  const audit: {
    unset_ok: boolean | null;
    unset_error: string | null;
    disconnect_ok: boolean;
    disconnect_error: string | null;
    // L4: post-disconnect verify. Did bundle.social actually drop the
    // account? deleted only flips true when verify_clean is also true.
    verify_clean: boolean | null;
    verify_reason: string | null;
    deleted: boolean;
    delete_error: string | null;
  } = {
    unset_ok: null,
    unset_error: null,
    disconnect_ok: false,
    disconnect_error: null,
    verify_clean: null,
    verify_reason: null,
    deleted: false,
    delete_error: null,
  };

  // Step 1: unset channel (only for channel-selection platforms with an
  // attached channel). Tolerates failure — proceeding to disconnect is
  // safe even when unset errors; bundle.social tears down the channel
  // binding alongside the account.
  if (
    CHANNEL_SELECTION_PLATFORMS.has(conn.bundlePlatform) &&
    !conn.is_personal_mode
  ) {
    const unset = await unsetChannel({
      teamId: conn.teamId,
      platform: conn.bundlePlatform,
    });
    audit.unset_ok = unset.ok;
    if (!unset.ok) audit.unset_error = unset.error.message;
  }

  // Step 2: 200ms settle. bundle.social's set-channel / unset-channel
  // ops cascade through the platform-side SDK; rapid unset → disconnect
  // can race with the unset's downstream sync and leave a partial
  // state. 200ms is empirically clean in the support-ticket history
  // we've seen.
  await new Promise((r) => setTimeout(r, 200));

  // Step 3: socialAccountDisconnect. The 400 "does not have" branch is
  // idempotent-success.
  try {
    await client.socialAccount.socialAccountDisconnect({
      requestBody: { type: conn.bundlePlatform, teamId: conn.teamId },
    });
    audit.disconnect_ok = true;
  } catch (err) {
    if (isAlreadyDisconnected400(err)) {
      audit.disconnect_ok = true;
      audit.disconnect_error = "Already disconnected at bundle.social (idempotent).";
    } else {
      audit.disconnect_error = err instanceof Error ? err.message : String(err);
      logger.warn("social.connections.disconnect.sdk_failed", {
        connection_id: conn.id,
        team_id: conn.teamId,
        platform: conn.bundlePlatform,
        err: audit.disconnect_error,
      });
    }
  }

  // Step 4: VERIFY (L4 split-brain defence). bundle.social must
  // confirm the account is actually gone before we delete the DB row.
  // verifyBundlesocialDisconnect handles the wait + retry-on-still-
  // present internally.
  const verify = await verifyBundlesocialDisconnect({
    teamId: conn.teamId,
    platform: conn.bundlePlatform,
  });
  audit.verify_clean = verify.clean;
  audit.verify_reason = verify.reason;

  const svc = getServiceRoleClient();
  if (!verify.clean) {
    // Split-brain detected — bundle.social still holds the account
    // after our disconnect + retry. DO NOT delete the DB row; it
    // remains the source of truth so the reconcile cron / admin
    // surface can resolve it.
    logger.error("social.connections.disconnect.split_brain_detected", {
      connection_id: conn.id,
      team_id: conn.teamId,
      platform: conn.bundlePlatform,
      reason: verify.reason,
    });
    void (async () => {
      try {
        await svc.from("platform_events").insert({
          event_type: "disconnect_split_brain_detected",
          company_id: conn.company_id,
          actor_id: gate.userId,
          entity_type: "social_connection",
          entity_id: conn.id,
          payload: {
            team_id: conn.teamId,
            platform: conn.bundlePlatform,
            bundle_social_account_id: conn.bundle_social_account_id,
            reason: verify.reason,
            ...audit,
          },
        });
      } catch (err) {
        logger.warn("social.connections.disconnect.split_brain_audit_failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return invalidState(
      "Disconnect could not be verified on bundle.social; the row was kept. An admin can resolve this from the maintenance reconcile surface.",
    );
  }

  // Step 5: bundle.social confirmed clean — DELETE the row.
  const del = await svc.from("social_connections").delete().eq("id", conn.id);
  if (del.error) {
    audit.delete_error = del.error.message;
    logger.error("social.connections.disconnect.delete_failed", {
      connection_id: conn.id,
      err: del.error.message,
    });
  } else {
    audit.deleted = true;
  }

  // Step 6: audit event. Fire-and-forget; the disconnect succeeded from
  // the customer's perspective regardless of audit insertion.
  void (async () => {
    try {
      await svc.from("platform_events").insert({
        event_type: "connection_disconnected",
        company_id: conn.company_id,
        actor_id: gate.userId,
        entity_type: "social_connection",
        entity_id: conn.id,
        payload: {
          platform: conn.platform,
          bundle_social_account_id: conn.bundle_social_account_id,
          bundle_platform: conn.bundlePlatform,
          ...audit,
        },
      });
    } catch (err) {
      logger.warn("social.connections.disconnect.audit_failed", {
        connection_id: conn.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  if (!audit.deleted) {
    return internalError(
      `Connection row delete failed: ${audit.delete_error ?? "unknown"}`,
      false,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        connection_id: conn.id,
        upstream_disconnect_ok: audit.disconnect_ok,
        upstream_unset_ok: audit.unset_ok,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
