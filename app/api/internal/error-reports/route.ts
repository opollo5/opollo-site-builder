import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderErrorReportEmail } from "@/lib/email/templates/error-report";
import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { scrubPayload } from "@/lib/error-reporting/scrubber";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ErrorReport } from "@/lib/error-reporting/types";

// POST /api/internal/error-reports
//
// Authenticated: any logged-in user (super_admin | admin | user).
// Rate-limited: 5 per user per 5 minutes.
// Persist first, mail second — if mail fails the row is preserved.
//
// Server-side enrichment: user identity (from the verified session, not
// from the client-supplied payload which is untrusted for identity).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSupabaseAuthOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

function errJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

// Loose schema — validate shape but not every nested leaf.
const Body = z.object({
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Auth gate -----------------------------------------------------------
  let userId: string | null = null;
  let userEmail: string | null = null;
  let userRole: string | null = null;

  if (isSupabaseAuthOn()) {
    let killSwitch = false;
    try { killSwitch = await isAuthKillSwitchOn(); } catch { killSwitch = false; }

    if (!killSwitch) {
      const supabase = createRouteAuthClient();
      const user = await getCurrentUser(supabase);
      if (!user) return errJson("UNAUTHORIZED", "Authentication required.", 401);
      userId = user.id;
      userEmail = user.email;
      userRole = user.role;
    }
  }

  // --- Rate limit ----------------------------------------------------------
  const rlId = userId ? `user:${userId}` : "anonymous";
  const rl = await checkRateLimit("error_report", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  // --- Parse body ----------------------------------------------------------
  const raw = await readJsonBody(req);
  if (!raw) return errJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return errJson("VALIDATION_FAILED", "Body must contain a 'payload' object.", 400);
  }

  // --- Scrub client payload (defence in depth) and enrich identity --------
  const clientPayload = scrubPayload(parsed.data.payload) as Partial<ErrorReport>;

  // Identity comes from the verified session, not from the client payload.
  const enrichedPayload: ErrorReport = {
    ...clientPayload,
    // Required fields with fallbacks
    browser: clientPayload.browser ?? "unknown",
    viewport: clientPayload.viewport ?? "unknown",
    locale: clientPayload.locale ?? "unknown",
    timezone: clientPayload.timezone ?? "unknown",
    timestamp: clientPayload.timestamp ?? new Date().toISOString(),
    currentUrl: clientPayload.currentUrl ?? "unknown",
    routeHistory: clientPayload.routeHistory ?? [],
    errorMessage: clientPayload.errorMessage ?? "(no message)",
    breadcrumbs: clientPayload.breadcrumbs ?? [],
    // Server-verified identity
    userId: userId ?? undefined,
    userEmail: userEmail ?? undefined,
    userRole: userRole ?? undefined,
  };

  // --- Persist row ---------------------------------------------------------
  const supabase = getServiceRoleClient();
  const { data: row, error: insertError } = await supabase
    .from("error_reports")
    .insert({
      user_id: userId,
      payload: enrichedPayload,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    logger.error("error_reports.insert_failed", { error: insertError?.message, userId });
    return errJson("INTERNAL_ERROR", "Failed to persist report.", 500);
  }

  const reportId: string = row.id;
  logger.info("error_reports.inserted", { report_id: reportId, user_id: userId });

  // --- Send email ----------------------------------------------------------
  const recipient = process.env.ERROR_REPORT_RECIPIENT;
  if (!recipient) {
    logger.warn("error_reports.no_recipient_env", { report_id: reportId });
    // Still return success — data is saved.
    return NextResponse.json({ ok: true, data: { report_id: reportId } });
  }

  const { subject, html, text } = renderErrorReportEmail(enrichedPayload, {
    userEmail: userEmail ?? undefined,
    userRole: userRole ?? undefined,
  });

  const mailResult = await sendEmail({ to: recipient, subject, html, text });

  // Update the row with mail status.
  const { error: updateError } = await supabase
    .from("error_reports")
    .update({
      mail_status: mailResult.ok ? "sent" : "failed",
      mail_error: mailResult.ok ? null : mailResult.error.message,
      mail_sent_at: mailResult.ok ? new Date().toISOString() : null,
    })
    .eq("id", reportId);

  if (updateError) {
    logger.warn("error_reports.update_mail_status_failed", {
      report_id: reportId,
      error: updateError.message,
    });
  }

  if (!mailResult.ok) {
    logger.error("error_reports.mail_failed", {
      report_id: reportId,
      error: mailResult.error.message,
    });
    // Return success to the client — the data is persisted, mail is best-effort.
  }

  return NextResponse.json({ ok: true, data: { report_id: reportId } });
}
