import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { PlatformCompany } from "./types";

// P3-2 — create a customer company. Caller (route handler) is responsible
// for permission checks; this lib only validates input + writes the row.
//
// Auto-generates a URL-safe slug from `name` if the caller doesn't supply
// one. Slug uniqueness is enforced at the schema layer (UNIQUE on
// platform_companies.slug); a 23505 collision is surfaced as
// SLUG_TAKEN so the caller can prompt for an alternate.

export type CreateCompanyInput = {
  name: string;
  // Optional — auto-generated from name when omitted.
  slug?: string;
  // Optional — customer's brand domain (e.g. "skyview.com"). Nullable in
  // the schema; pass null/undefined to leave unset.
  domain?: string | null;
  timezone?: string;
  createdBy: string | null;
};

const DEFAULT_TIMEZONE = "Australia/Melbourne";
const SLUG_RE = /^[a-z0-9-]+$/;

export async function createPlatformCompany(
  input: CreateCompanyInput,
): Promise<ApiResponse<PlatformCompany>> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return validation("Name is required.");
  }
  if (trimmedName.length > 200) {
    return validation("Name must be 200 characters or fewer.");
  }

  const slug = (input.slug?.trim() || slugify(trimmedName)).toLowerCase();
  if (!slug || !SLUG_RE.test(slug)) {
    return validation(
      "Slug must contain only lowercase letters, digits, and hyphens.",
    );
  }
  if (slug.length > 60) {
    return validation("Slug must be 60 characters or fewer.");
  }

  const domain = input.domain?.trim() || null;
  if (domain !== null && domain.length > 253) {
    return validation("Domain must be 253 characters or fewer.");
  }

  const timezone = (input.timezone ?? DEFAULT_TIMEZONE).trim();

  const svc = getServiceRoleClient();
  const result = await svc
    .from("platform_companies")
    .insert({
      name: trimmedName,
      slug,
      domain,
      timezone,
      is_opollo_internal: false,
    })
    .select(
      "id, name, slug, domain, timezone, is_opollo_internal, approval_default_required, approval_default_rule, concurrent_publish_limit, created_at, updated_at",
    )
    .single();

  if (result.error) {
    if (result.error.code === "23505") {
      // Two unique constraints can fire here: idx_companies_one_internal
      // (singleton) and the slug UNIQUE. We don't write is_opollo_internal=true
      // from this path, so 23505 is always a slug collision.
      return {
        ok: false,
        error: {
          code: "ALREADY_EXISTS",
          message: `Slug "${slug}" is already taken. Try a different name or supply a custom slug.`,
          retryable: false,
          suggested_action: "Pick a different slug and resubmit.",
        },
        timestamp: new Date().toISOString(),
      };
    }
    logger.error("platform.companies.create.failed", {
      err: result.error.message,
      code: result.error.code,
    });
    return internal(`Failed to create company: ${result.error.message}`);
  }

  // createdBy is captured for future audit-log expansion; the V1
  // platform_companies schema doesn't carry created_by/updated_by today.
  void input.createdBy;

  return {
    ok: true,
    data: result.data as PlatformCompany,
    timestamp: new Date().toISOString(),
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function validation(message: string): ApiResponse<PlatformCompany> {
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

function internal(message: string): ApiResponse<PlatformCompany> {
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
