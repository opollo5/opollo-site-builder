import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ViewerLink } from "./types";

// ---------------------------------------------------------------------------
// S1-15 — soft-revoke a viewer link. Atomic UPDATE WHERE revoked_at
// IS NULL handles concurrent revokes; second caller sees INVALID_STATE.
//
// Caller is responsible for canDo("manage_invitations", company_id).
// ---------------------------------------------------------------------------

export async function revokeViewerLink(args: {
  linkId: string;
  companyId: string;
}): Promise<ApiResponse<ViewerLink>> {
  if (!args.linkId) return validation("Link id is required.");
  if (!args.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // Lookup first so we can return NOT_FOUND for cross-company access
  // distinctly from already-revoked.
  const lookup = await svc
    .from("social_viewer_links")
    .select("id, revoked_at")
    .eq("id", args.linkId)
    .eq("company_id", args.companyId)
    .maybeSingle();
  if (lookup.error) {
    logger.error("social.viewer_links.revoke.lookup_failed", {
      err: lookup.error.message,
    });
    return internal(`Failed to read viewer link: ${lookup.error.message}`);
  }
  if (!lookup.data) return notFound();
  if (lookup.data.revoked_at) {
    return invalidState("Viewer link is already revoked.");
  }

  const update = await svc
    .from("social_viewer_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", args.linkId)
    .eq("company_id", args.companyId)
    .is("revoked_at", null)
    .select(
      "id, company_id, recipient_email, recipient_name, expires_at, revoked_at, last_viewed_at, created_by, created_at",
    )
    .maybeSingle();
  if (update.error) {
    logger.error("social.viewer_links.revoke.update_failed", {
      err: update.error.message,
    });
    return internal(`Failed to revoke: ${update.error.message}`);
  }
  if (!update.data) {
    return invalidState("Viewer link was revoked concurrently.");
  }

  return {
    ok: true,
    data: update.data as ViewerLink,
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<ViewerLink> {
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

function notFound(): ApiResponse<ViewerLink> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No viewer link with that id in this company.",
      retryable: false,
      suggested_action: "Check the link id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function invalidState(message: string): ApiResponse<ViewerLink> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action: "Reload and try again if needed.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<ViewerLink> {
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
