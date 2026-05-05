import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { PlatformCompanyListItem } from "./types";

// Returns every customer company (and the Opollo internal company) ordered
// by created_at desc. Caller is expected to be Opollo staff — the route /
// page handler enforces is_opollo_staff before invoking this. The lib does
// NOT re-check; it trusts the caller.
//
// Member count is computed via a separate query rather than an embedded
// join because platform_company_users has multiple FKs back to
// platform_users (user_id + added_by) and PostgREST embed errors out on
// the ambiguity. See feedback memory "PostgREST embed fails on multi-FK
// tables" (2026-05-02). Two queries keep the lib resilient and readable.

export async function listPlatformCompanies(): Promise<
  ApiResponse<{ companies: PlatformCompanyListItem[] }>
> {
  const svc = getServiceRoleClient();
  const now = () => new Date().toISOString();

  const companiesResult = await svc
    .from("platform_companies")
    .select("id, name, slug, domain, timezone, is_opollo_internal, created_at")
    .order("created_at", { ascending: false });

  if (companiesResult.error) {
    logger.error("platform.companies.list.failed", {
      err: companiesResult.error.message,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Failed to list companies: ${companiesResult.error.message}`,
        retryable: false,
        suggested_action: "Retry. If the error persists, contact support.",
      },
      timestamp: now(),
    };
  }

  const companies = companiesResult.data ?? [];
  if (companies.length === 0) {
    return { ok: true, data: { companies: [] }, timestamp: now() };
  }

  // Single membership query covering every company in the result set.
  // Postgres returns one row per (company_id, user_id) — group locally.
  const membershipResult = await svc
    .from("platform_company_users")
    .select("company_id")
    .in(
      "company_id",
      companies.map((c) => c.id),
    );

  if (membershipResult.error) {
    logger.error("platform.companies.list.membership_count_failed", {
      err: membershipResult.error.message,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Failed to count members: ${membershipResult.error.message}`,
        retryable: false,
        suggested_action: "Retry. If the error persists, contact support.",
      },
      timestamp: now(),
    };
  }

  const counts = new Map<string, number>();
  for (const row of membershipResult.data ?? []) {
    const companyId = row.company_id as string;
    counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
  }

  const items: PlatformCompanyListItem[] = companies.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: c.slug as string,
    domain: (c.domain as string | null) ?? null,
    timezone: c.timezone as string,
    is_opollo_internal: c.is_opollo_internal as boolean,
    member_count: counts.get(c.id as string) ?? 0,
    created_at: c.created_at as string,
  }));

  return { ok: true, data: { companies: items }, timestamp: now() };
}
