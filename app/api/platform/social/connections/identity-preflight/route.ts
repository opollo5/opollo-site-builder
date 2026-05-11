import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Cross-tenant identity-leak defence — Layer 3: pre-flight warning at
// connect-initiation. Layer 2 (sync-layer hard block) is the backstop;
// this surface warns the user BEFORE the OAuth popup opens.
//
// Returns { warn: true, others: [{company_name, connected_at}] } when the
// caller (or another admin) has previously connected the same platform
// for a different company. UI uses this to render a confirmation modal
// explaining what will happen if the OAuth flow auto-approves.
//
// Heuristic: any social_connections row for the same platform under a
// DIFFERENT company_id where the current user is a member, OR — for
// Opollo staff — any other company within the last 24 hours. This is a
// warning, not a block; over-warning is acceptable. The hard block lives
// in lib/platform/social/connections/identity.ts → checkCrossTenantConflict.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_TO_BUNDLE: Record<string, string> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const platformParam = url.searchParams.get("platform");
  const targetCompanyId = url.searchParams.get("target_company_id");
  const targetProfileId = url.searchParams.get("target_profile_id");

  if (!platformParam || !targetCompanyId) {
    return validationError("platform and target_company_id are required.");
  }

  const gate = await requireCanDoForApi(targetCompanyId, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  const session = await getCurrentPlatformSession();
  if (!session) {
    return validationError("Authentication required.");
  }

  // Normalize: accept either our enum value (linkedin_personal) or the
  // bundle.social raw type (LINKEDIN). The DB query uses our enum.
  const platform = platformParam.toLowerCase();
  const knownPlatform =
    platform in PLATFORM_TO_BUNDLE
      ? platform
      : Object.entries(PLATFORM_TO_BUNDLE).find(
          ([_, raw]) => raw === platformParam.toUpperCase(),
        )?.[0];

  if (!knownPlatform) {
    return validationError(`Unknown platform: ${platformParam}`);
  }

  try {
    const svc = getServiceRoleClient();

    // Resolve which OTHER companies the user can see for the warning.
    // - For non-staff users: every company they're a member of, minus
    //   the target.
    // - For Opollo staff: every active company seen recently (broader
    //   warning surface because staff are the highest-risk operators).
    let visibleCompanyIds: string[] = [];
    if (session.isOpolloStaff) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recent = await svc
        .from("social_connections")
        .select("company_id")
        .neq("company_id", targetCompanyId)
        .eq("platform", knownPlatform)
        .gte("connected_at", since);
      if (recent.error) {
        logger.error("social.identity.preflight.staff_lookup_failed", {
          err: recent.error.message,
        });
        return internalError("Pre-flight lookup failed.");
      }
      visibleCompanyIds = Array.from(
        new Set((recent.data ?? []).map((r) => r.company_id as string)),
      );
    } else {
      const memberships = await svc
        .from("platform_company_users")
        .select("company_id")
        .eq("user_id", session.userId);
      if (memberships.error) {
        logger.error("social.identity.preflight.membership_lookup_failed", {
          err: memberships.error.message,
        });
        return internalError("Pre-flight lookup failed.");
      }
      visibleCompanyIds = (memberships.data ?? [])
        .map((r) => r.company_id as string)
        .filter((id) => id !== targetCompanyId);
    }

    if (visibleCompanyIds.length === 0) {
      return NextResponse.json({
        ok: true,
        data: { warn: false, others: [] },
        timestamp: new Date().toISOString(),
      });
    }

    // Look up healthy/auth_required/pending_identity connections for the
    // same platform in those companies.
    let connectionsQuery = svc
      .from("social_connections")
      .select("company_id, connected_at")
      .eq("platform", knownPlatform)
      .in("company_id", visibleCompanyIds)
      .neq("status", "disconnected")
      .order("connected_at", { ascending: false });
    if (targetProfileId) {
      // Optional: when caller passes target_profile_id, also exclude
      // siblings in the same company (no-op here because we already
      // .neq target_company_id above; the param is reserved for a
      // future per-profile-aware pre-flight).
      void targetProfileId;
    }
    const conns = await connectionsQuery;
    if (conns.error) {
      logger.error("social.identity.preflight.conn_lookup_failed", {
        err: conns.error.message,
      });
      return internalError("Pre-flight lookup failed.");
    }

    if ((conns.data?.length ?? 0) === 0) {
      return NextResponse.json({
        ok: true,
        data: { warn: false, others: [] },
        timestamp: new Date().toISOString(),
      });
    }

    // Look up company names for the warning UI.
    const conflictingCompanyIds = Array.from(
      new Set((conns.data ?? []).map((r) => r.company_id as string)),
    );
    const companies = await svc
      .from("platform_companies")
      .select("id, name")
      .in("id", conflictingCompanyIds);
    const nameById = new Map<string, string>();
    for (const c of companies.data ?? []) {
      nameById.set(c.id as string, c.name as string);
    }

    // Dedupe per company, keep the most recent connected_at.
    const seen = new Set<string>();
    const others: Array<{ company_name: string; connected_at: string }> = [];
    for (const row of conns.data ?? []) {
      const cid = row.company_id as string;
      if (seen.has(cid)) continue;
      seen.add(cid);
      others.push({
        company_name: nameById.get(cid) ?? "(unknown company)",
        connected_at: row.connected_at as string,
      });
    }

    return NextResponse.json({
      ok: true,
      data: { warn: others.length > 0, others },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("social.identity.preflight.unexpected", {
      err: err instanceof Error ? err.message : String(err),
    });
    return internalError("Pre-flight lookup failed.");
  }
}
