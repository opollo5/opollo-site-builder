import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ListViewerLinksInput, ViewerLink } from "./types";

// ---------------------------------------------------------------------------
// S1-15 — list viewer links for a company.
//
// Default: only active (not revoked, not expired). includeInactive=true
// surfaces history for the admin UI's "show old links" toggle.
//
// Caller is responsible for canDo("manage_invitations", company_id).
// ---------------------------------------------------------------------------

export async function listViewerLinks(
  input: ListViewerLinksInput,
): Promise<ApiResponse<{ links: ViewerLink[] }>> {
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();
  let query = svc
    .from("social_viewer_links")
    .select(
      "id, company_id, recipient_email, recipient_name, expires_at, revoked_at, last_viewed_at, created_by, created_at",
    )
    .eq("company_id", input.companyId)
    .order("created_at", { ascending: false });

  if (!input.includeInactive) {
    query = query
      .is("revoked_at", null)
      .gte("expires_at", new Date().toISOString());
  }

  const result = await query;
  if (result.error) {
    logger.error("social.viewer_links.list.failed", {
      err: result.error.message,
      company_id: input.companyId,
    });
    return internal(`Failed to list viewer links: ${result.error.message}`);
  }

  return {
    ok: true,
    data: { links: (result.data ?? []) as ViewerLink[] },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<{ links: ViewerLink[] }> {
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

function internal(message: string): ApiResponse<{ links: ViewerLink[] }> {
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
