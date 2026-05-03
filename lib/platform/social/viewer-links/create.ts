import "server-only";

import { logger } from "@/lib/logger";
import { generateRawToken, hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  CreateViewerLinkInput,
  CreateViewerLinkResult,
  ViewerLink,
} from "./types";

// ---------------------------------------------------------------------------
// S1-15 — mint a new viewer link.
//
// Default 90-day TTL. Returns the raw token ONCE so the route can build
// the URL the admin pastes into an external email; only the SHA-256
// hash hits disk. Same token shape as platform_invitations + social
// approval recipients.
//
// Caller is responsible for canDo("manage_invitations", company_id) —
// sharing externally is admin-level (matches the invitation surface).
// ---------------------------------------------------------------------------

const VIEWER_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export async function createViewerLink(
  input: CreateViewerLinkInput,
): Promise<ApiResponse<CreateViewerLinkResult>> {
  if (!input.companyId) return validation("Company id is required.");

  const recipientEmail = normaliseEmail(input.recipientEmail);
  const recipientName = input.recipientName?.trim() || null;
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + VIEWER_LINK_TTL_MS).toISOString();

  if (Date.parse(expiresAt) <= Date.now()) {
    return validation("expires_at must be in the future.");
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  const svc = getServiceRoleClient();
  const insert = await svc
    .from("social_viewer_links")
    .insert({
      company_id: input.companyId,
      token_hash: tokenHash,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      expires_at: expiresAt,
      created_by: input.createdBy,
    })
    .select(
      "id, company_id, recipient_email, recipient_name, expires_at, revoked_at, last_viewed_at, created_by, created_at",
    )
    .single();

  if (insert.error) {
    logger.error("social.viewer_links.create.failed", {
      err: insert.error.message,
      code: insert.error.code,
      company_id: input.companyId,
    });
    return internal(`Failed to create viewer link: ${insert.error.message}`);
  }

  return {
    ok: true,
    data: {
      link: insert.data as ViewerLink,
      rawToken,
    },
    timestamp: new Date().toISOString(),
  };
}

function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function validation(message: string): ApiResponse<CreateViewerLinkResult> {
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

function internal(message: string): ApiResponse<CreateViewerLinkResult> {
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
