import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// Per-invocation cache: avoid multiple DB queries within one notify cycle.
let cachedEmails: string[] | null = null;
let cachePopulatedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Returns email addresses for all Opollo staff (is_opollo_staff = true).
 * These are the recipients for service health alerts.
 *
 * CLAUDE-ASSUMPTION: brief says 'company_users WHERE role = platform_admin'
 * but platform_admin is not in platform_company_role enum. Using
 * platform_users WHERE is_opollo_staff = true — the correct gate for
 * internal observability per migration 0070.
 *
 * Cached for 1 minute per invocation to avoid repeated queries within
 * one notify cycle.
 */
export async function getPlatformAdminEmails(): Promise<string[]> {
  if (cachedEmails !== null && Date.now() - cachePopulatedAt < CACHE_TTL_MS) {
    return cachedEmails;
  }

  try {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("platform_users")
      .select("email")
      .eq("is_opollo_staff", true)
      .is("deleted_at", null);

    if (error) {
      logger.warn("service_health.recipients_query_failed", { err: error.message });
      return cachedEmails ?? [];
    }

    cachedEmails = (data ?? []).map((r: { email: string }) => r.email).filter(Boolean);
    cachePopulatedAt = Date.now();
    return cachedEmails;
  } catch (err) {
    logger.warn("service_health.recipients_fetch_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return cachedEmails ?? [];
  }
}

/** Reset cache — used in tests */
export function __resetRecipientsCacheForTests(): void {
  cachedEmails = null;
  cachePopulatedAt = 0;
}
