import "server-only";

import { createHash } from "node:crypto";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Cross-tenant identity-leak defence — Layer 2.
//
// The reported leak (docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md):
// a person who authorises bundle.social for the same platform across
// multiple companies in one browser session ends up attached to each
// company's bundle.social team without re-prompting, because the
// platform-side OAuth provider silently auto-approves the repeat grant.
// Our DB stores each as a distinct bundle.social account id, but the
// underlying platform-side identity is identical.
//
// This module fingerprints the platform-side identity behind every
// social_connections row and refuses inserts/updates that would attach
// the same identity under more than one company (or more than one
// profile within the same company).
//
// Platform-agnostic by design: works for every bundle.social platform.
// The SDK's socialAccountGetByType response has a uniform shape
// (`externalId`, `userId`, `userUsername`); we don't branch per
// platform here. Per-platform semantics:
//
//   LINKEDIN        externalId = urn:li:person|urn:li:organization
//                   userId     = urn:li:person (the human)
//   FACEBOOK        externalId = Page id
//                   userId     = FB user id
//   INSTAGRAM       externalId = IG account id
//                   userId     = FB user id (IG via FB graph)
//   YOUTUBE         externalId = YouTube channel id
//                   userId     = Google account id
//   GOOGLE_BUSINESS externalId = Location id
//                   userId     = Google account id
//   TWITTER (X)     externalId = X user id
//                   userId     = X user id (same)
//   TIKTOK          externalId = TikTok account id
//                   userId     = TikTok account id (same)
//   PINTEREST       externalId = Pinterest user id
//                   userId     = Pinterest user id (same)
//   THREADS         externalId = Threads account id
//                   userId     = Threads account id (same)
//   REDDIT          externalId = Reddit user id
//                   userId     = Reddit user id (same)
//   BLUESKY         externalId = Bluesky DID
//                   userId     = Bluesky DID (same)
//   MASTODON        externalId = Mastodon account url
//                   userId     = Mastodon account url (same)
//   DISCORD         externalId = Discord guild/channel id
//                   userId     = Discord user id
//   SLACK           externalId = Slack channel/workspace id
//                   userId     = Slack user id
//
// For platforms where externalId and userId are conceptually the same
// (TIKTOK, X, etc.), both columns are populated to the same value so
// the cross-tenant detector still fires symmetrically.
// ---------------------------------------------------------------------------

// All bundle.social-supported platform types. We accept any string at
// runtime but expose this union for type-safe call sites.
export type BundlesocialPlatformType =
  | "TIKTOK"
  | "YOUTUBE"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TWITTER"
  | "THREADS"
  | "LINKEDIN"
  | "PINTEREST"
  | "REDDIT"
  | "MASTODON"
  | "DISCORD"
  | "SLACK"
  | "BLUESKY"
  | "GOOGLE_BUSINESS";

// Identity fingerprint resolved from bundle.social for a (team, type)
// pair. external_identity_hash is null when EITHER identity field is
// null — the connection is in "pending_identity" state until the user
// completes channel selection on the platform side.
export type IdentityFingerprint = {
  external_account_id: string | null;
  external_user_id: string | null;
  external_identity_hash: string | null;
  raw: Record<string, unknown>;
};

// Deterministic identity hash. Returns null when both ids are null
// (no platform identity to fingerprint yet). When only one is null,
// hashes the non-null value plus a literal empty string so the hash
// is still stable.
export function computeIdentityHash(
  platform: string,
  accountId: string | null,
  userId: string | null,
): string | null {
  if (!accountId && !userId) return null;
  const input = `${platform}:${accountId ?? ""}:${userId ?? ""}`;
  return createHash("md5").update(input).digest("hex");
}

// Resolve identity from bundle.social. Caller passes the bundle.social
// platform type (LINKEDIN, FACEBOOK, etc.) and team id. Returns null
// identity fields if the SDK call fails (caller should treat as
// pending_identity and retry on the next sync).
export async function resolveIdentityFingerprint(input: {
  platform: BundlesocialPlatformType;
  teamId: string;
}): Promise<IdentityFingerprint> {
  const client = getBundlesocialClient();
  if (!client) {
    return {
      external_account_id: null,
      external_user_id: null,
      external_identity_hash: null,
      raw: {},
    };
  }
  try {
    const resp = (await client.socialAccount.socialAccountGetByType({
      teamId: input.teamId,
      type: input.platform,
    })) as {
      externalId?: string | null;
      userId?: string | null;
      userUsername?: string | null;
      userDisplayName?: string | null;
    };
    const accountId = resp.externalId ?? null;
    const userId = resp.userId ?? null;
    return {
      external_account_id: accountId,
      external_user_id: userId,
      external_identity_hash: computeIdentityHash(
        input.platform,
        accountId,
        userId,
      ),
      raw: resp as Record<string, unknown>,
    };
  } catch (err) {
    logger.warn("social.identity.resolve_failed", {
      platform: input.platform,
      team_id: input.teamId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      external_account_id: null,
      external_user_id: null,
      external_identity_hash: null,
      raw: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Cross-tenant detector.
// ---------------------------------------------------------------------------

export type CrossTenantCheckInput = {
  // The platform value as stored on social_connections.platform (the
  // SocialPlatform enum value — e.g. "linkedin_personal", "facebook_page").
  platform: string;
  identity_hash: string | null;
  external_account_id: string | null;
  external_user_id: string | null;
  target_company_id: string;
  target_profile_id: string | null;
  // Optional: exclude a specific connection from the conflict check.
  // Used by re-attribute flows where the row being moved must not
  // conflict with itself.
  excludeConnectionId?: string;
};

export type CrossTenantConflict = {
  id: string;
  company_id: string;
  profile_id: string | null;
  platform: string;
  display_name: string | null;
  external_account_id: string | null;
  external_user_id: string | null;
  external_identity_hash: string | null;
};

export type CrossTenantCheckResult =
  | { ok: true }
  | {
      ok: false;
      code: "CROSS_TENANT" | "CROSS_PROFILE";
      override_allowed: boolean;
      conflicting_rows: CrossTenantConflict[];
    };

// Hard block: does the requested attachment conflict with an existing
// social_connections row that has the same platform identity but a
// DIFFERENT company_id (CROSS_TENANT) or the same company_id but a
// DIFFERENT profile_id (CROSS_PROFILE)?
//
// Checks three index hits in parallel:
//   1. external_identity_hash equality — full-identity match.
//   2. (platform, external_account_id) — same Page / channel / location.
//   3. (platform, external_user_id) — same human grantor.
//
// Any one of these matching under a different company_id is a
// cross-tenant conflict. Under the same company_id but a different
// profile_id is a cross-profile conflict.
//
// Returns ok:true when no conflict OR when the target company has
// allow_cross_tenant_identity=true AND override_allowed is set on the
// result (caller is responsible for honouring the override and
// emitting the audit event).
export async function checkCrossTenantConflict(
  input: CrossTenantCheckInput,
): Promise<CrossTenantCheckResult> {
  const svc = getServiceRoleClient();

  // Gather every potentially-conflicting row in parallel. Each query
  // hits one of the three partial indices added by migration 0122.
  type QueryResult = {
    data: CrossTenantConflict[];
    error: { message: string } | null;
  };
  const queries: Promise<QueryResult>[] = [];
  const cols =
    "id, company_id, profile_id, platform, display_name, external_account_id, external_user_id, external_identity_hash";

  if (input.identity_hash) {
    queries.push(
      (async (): Promise<QueryResult> => {
        const r = await svc
          .from("social_connections")
          .select(cols)
          .eq("external_identity_hash", input.identity_hash as string);
        return {
          data: (r.data ?? []) as CrossTenantConflict[],
          error: r.error,
        };
      })(),
    );
  }
  if (input.external_account_id) {
    queries.push(
      (async (): Promise<QueryResult> => {
        const r = await svc
          .from("social_connections")
          .select(cols)
          .eq("platform", input.platform)
          .eq("external_account_id", input.external_account_id as string);
        return {
          data: (r.data ?? []) as CrossTenantConflict[],
          error: r.error,
        };
      })(),
    );
  }
  if (input.external_user_id) {
    queries.push(
      (async (): Promise<QueryResult> => {
        const r = await svc
          .from("social_connections")
          .select(cols)
          .eq("platform", input.platform)
          .eq("external_user_id", input.external_user_id as string);
        return {
          data: (r.data ?? []) as CrossTenantConflict[],
          error: r.error,
        };
      })(),
    );
  }

  if (queries.length === 0) {
    // Nothing to check against — identity is fully null. Caller
    // should set status='pending_identity' but the row is allowed
    // to insert.
    return { ok: true };
  }

  const results = await Promise.all(queries);
  for (const r of results) {
    if (r.error) {
      logger.error("social.identity.cross_tenant_query_failed", {
        err: r.error.message,
        platform: input.platform,
      });
      // Fail closed — if we can't run the detector, refuse the write.
      return {
        ok: false,
        code: "CROSS_TENANT",
        override_allowed: false,
        conflicting_rows: [],
      };
    }
  }

  // Dedup by row id; collect cross-tenant and cross-profile separately.
  const allRows = new Map<string, CrossTenantConflict>();
  for (const r of results) {
    for (const row of r.data ?? []) {
      if (input.excludeConnectionId && row.id === input.excludeConnectionId) {
        continue;
      }
      allRows.set(row.id, row);
    }
  }

  // Classification:
  //   Cross-tenant — ANY partial-identity match across companies. The leak
  //   case "Customer A and Customer B both think they have Steve's
  //   LinkedIn" is caught even when only user_id matches (different
  //   account_id) or only account_id matches (different user_id).
  //
  //   Cross-profile — FULL-identity match (hash) within the same company
  //   but a different profile. We allow profile A and profile B in the
  //   same company to share a human grantor (user_id) attached to
  //   different pages (account_id) — that's a legitimate multi-profile
  //   setup. The block fires only when the same hash (same page + same
  //   human) is being attached twice within a company.
  const crossTenant: CrossTenantConflict[] = [];
  const crossProfile: CrossTenantConflict[] = [];
  for (const row of allRows.values()) {
    if (row.company_id !== input.target_company_id) {
      crossTenant.push(row);
      continue;
    }
    // Same company. Cross-profile only fires on full hash match.
    if (
      input.identity_hash &&
      row.external_identity_hash === input.identity_hash &&
      input.target_profile_id !== null &&
      row.profile_id !== null &&
      row.profile_id !== input.target_profile_id
    ) {
      crossProfile.push(row);
    }
  }

  if (crossTenant.length === 0 && crossProfile.length === 0) {
    return { ok: true };
  }

  // Cross-tenant takes precedence — it's the more severe conflict.
  if (crossTenant.length > 0) {
    const overrideAllowed = await readAllowCrossTenant(input.target_company_id);
    return {
      ok: false,
      code: "CROSS_TENANT",
      override_allowed: overrideAllowed,
      conflicting_rows: crossTenant,
    };
  }

  return {
    ok: false,
    code: "CROSS_PROFILE",
    override_allowed: false, // No override for cross-profile within the same company.
    conflicting_rows: crossProfile,
  };
}

// Read the target company's allow_cross_tenant_identity flag. Returns
// false on any error (fail-closed).
async function readAllowCrossTenant(companyId: string): Promise<boolean> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_companies")
    .select("allow_cross_tenant_identity")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(
    (data as { allow_cross_tenant_identity?: boolean }).allow_cross_tenant_identity,
  );
}

// ---------------------------------------------------------------------------
// Audit emitters — fire-and-forget. Callers should not block on these.
// ---------------------------------------------------------------------------

export async function emitCrossTenantBlocked(args: {
  platform: string;
  identity_hash: string | null;
  external_account_id: string | null;
  external_user_id: string | null;
  target_company_id: string;
  target_profile_id: string | null;
  actor_user_id?: string | null;
  conflicting_rows: CrossTenantConflict[];
}): Promise<void> {
  const svc = getServiceRoleClient();
  try {
    await svc.from("platform_events").insert({
      event_type: "cross_tenant_blocked",
      company_id: args.target_company_id,
      actor_id: args.actor_user_id ?? null,
      entity_type: "social_connection",
      payload: {
        platform: args.platform,
        identity_hash: args.identity_hash,
        external_account_id: args.external_account_id,
        external_user_id: args.external_user_id,
        target_profile_id: args.target_profile_id,
        conflicting_rows: args.conflicting_rows,
      },
    });
  } catch (err) {
    logger.warn("social.identity.audit_blocked_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function emitCrossTenantOverride(args: {
  platform: string;
  identity_hash: string | null;
  external_account_id: string | null;
  external_user_id: string | null;
  target_company_id: string;
  target_profile_id: string | null;
  actor_user_id?: string | null;
  conflicting_rows: CrossTenantConflict[];
}): Promise<void> {
  const svc = getServiceRoleClient();
  try {
    await svc.from("platform_events").insert({
      event_type: "cross_tenant_override",
      company_id: args.target_company_id,
      actor_id: args.actor_user_id ?? null,
      entity_type: "social_connection",
      payload: {
        platform: args.platform,
        identity_hash: args.identity_hash,
        external_account_id: args.external_account_id,
        external_user_id: args.external_user_id,
        target_profile_id: args.target_profile_id,
        conflicting_rows: args.conflicting_rows,
        allowed_by: "platform_companies.allow_cross_tenant_identity",
      },
    });
  } catch (err) {
    logger.warn("social.identity.audit_override_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function emitConnectionReattributed(args: {
  connection_id: string;
  platform: string;
  from_company_id: string;
  to_company_id: string;
  from_profile_id: string | null;
  to_profile_id: string | null;
  actor_user_id?: string | null;
}): Promise<void> {
  const svc = getServiceRoleClient();
  try {
    await svc.from("platform_events").insert({
      event_type: "connection_reattributed",
      company_id: args.to_company_id,
      actor_id: args.actor_user_id ?? null,
      entity_type: "social_connection",
      entity_id: args.connection_id,
      payload: {
        platform: args.platform,
        from_company_id: args.from_company_id,
        to_company_id: args.to_company_id,
        from_profile_id: args.from_profile_id,
        to_profile_id: args.to_profile_id,
      },
    });
  } catch (err) {
    logger.warn("social.identity.audit_reattribute_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
