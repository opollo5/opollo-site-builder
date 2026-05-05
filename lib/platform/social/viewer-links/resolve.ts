import "server-only";

import { logger } from "@/lib/logger";
import { hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ViewerLink } from "./types";

// ---------------------------------------------------------------------------
// S1-15 — public token-as-auth resolver for /viewer/[token].
//
// Hash + lookup. Validates: not revoked, not expired. Best-effort
// last_viewed_at refresh on every successful resolve so the admin
// surface can show "last seen by viewer X minutes ago" without a
// separate ping endpoint.
//
// NOT_FOUND envelopes for:
//   - malformed token shape
//   - token doesn't match any row
//   - row is revoked
//   - row is past expires_at
//
// All collapse to the same generic "this link is invalid or expired"
// envelope so the public viewer can't enumerate states.
// ---------------------------------------------------------------------------

export async function resolveViewerLink(
  rawToken: string,
): Promise<
  ApiResponse<{
    link: ViewerLink;
    company: { id: string; name: string; timezone: string };
  }>
> {
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return notFound();
  }

  const tokenHash = hashToken(rawToken);
  const svc = getServiceRoleClient();

  const link = await svc
    .from("social_viewer_links")
    .select(
      "id, company_id, recipient_email, recipient_name, expires_at, revoked_at, last_viewed_at, created_by, created_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (link.error) {
    logger.error("social.viewer_links.resolve.lookup_failed", {
      err: link.error.message,
    });
    return internal(`Failed to read viewer link: ${link.error.message}`);
  }
  if (!link.data) return notFound();

  const linkRow = link.data as ViewerLink;
  if (linkRow.revoked_at) return notFound();
  if (Date.parse(linkRow.expires_at) <= Date.now()) return notFound();

  const company = await svc
    .from("platform_companies")
    .select("id, name, timezone")
    .eq("id", linkRow.company_id)
    .maybeSingle();
  if (company.error || !company.data) {
    return internal("Company missing for this viewer link.");
  }

  // Best-effort last_viewed_at refresh. Failure here doesn't fail the
  // resolve — the viewer should still see the calendar.
  void svc
    .from("social_viewer_links")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", linkRow.id)
    .then((r) => {
      if (r.error) {
        logger.warn("social.viewer_links.resolve.last_viewed_update_failed", {
          err: r.error.message,
        });
      }
    });

  return {
    ok: true,
    data: {
      link: linkRow,
      company: company.data as { id: string; name: string; timezone: string },
    },
    timestamp: new Date().toISOString(),
  };
}

function notFound(): ApiResponse<{
  link: ViewerLink;
  company: { id: string; name: string; timezone: string };
}> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "This calendar link is invalid or has expired.",
      retryable: false,
      suggested_action: "Ask the team that sent the link for a fresh one.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<{
  link: ViewerLink;
  company: { id: string; name: string; timezone: string };
}> {
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
