import { NextResponse, type NextRequest } from "next/server";

import { sendEmail } from "@/lib/email/sendgrid";
import { renderPortalPreExpiryEmail } from "@/lib/email/templates/portal-pre-expiry";
import type { PreExpiryStage } from "@/lib/email/templates/portal-pre-expiry";
import { logger } from "@/lib/logger";
import { issue } from "@/lib/platform/magic-link";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/cron/social-connections-pre-expiry
//
// B4 pre-expiry warning cron. Runs daily at 08:30 UTC (after the health
// cron at 03:00, giving it time to update expires_at from webhooks).
//
// SCOPE CONSTRAINT (CLAUDE.md B4, migration 0178 comment):
//   This cron may ONLY write pre_expiry_7d_sent_at and pre_expiry_1d_sent_at
//   on social_connections. It must NOT write status, external_identity_hash,
//   external_account_id, expires_at, or any binding-related field.
//
// Stages:
//   7d — expires_at within 7 days, pre_expiry_7d_sent_at IS NULL
//   1d — expires_at within 1 day, pre_expiry_1d_sent_at IS NULL
//
// Recipient: company.portal_contact_email → fallback to primary admin.
// One email per stage per expiry cycle. Idempotent: UPDATE WHERE sent_at IS NULL.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PLATFORM_DISPLAY: Record<string, string> = {
  linkedin_personal: "LinkedIn",
  linkedin_company:  "LinkedIn (Company)",
  facebook_page:     "Facebook",
  x:                 "X (Twitter)",
  gbp:               "Google Business Profile",
};

async function handle(req: NextRequest): Promise<NextResponse> {
  const svc = getServiceRoleClient();
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const in1d = new Date(now.getTime() + 1 * 86_400_000).toISOString();

  let processed = 0;
  let sent = 0;
  let errors = 0;

  // ─── Stage: 7d notices ─────────────────────────────────────────────────
  const { data: due7d } = await svc
    .from("social_connections")
    .select(
      "id, company_id, platform, display_name, expires_at, pre_expiry_7d_sent_at",
    )
    .lte("expires_at", in7d)
    .gt("expires_at", now.toISOString())
    .is("pre_expiry_7d_sent_at", null)
    .eq("status", "healthy")
    .is("disconnected_at", null);

  for (const conn of due7d ?? []) {
    processed++;
    const result = await sendNotice(svc, conn, "7d", req.nextUrl.origin);
    if (result) sent++; else errors++;
  }

  // ─── Stage: 1d notices ─────────────────────────────────────────────────
  const { data: due1d } = await svc
    .from("social_connections")
    .select(
      "id, company_id, platform, display_name, expires_at, pre_expiry_1d_sent_at",
    )
    .lte("expires_at", in1d)
    .gt("expires_at", now.toISOString())
    .is("pre_expiry_1d_sent_at", null)
    .is("disconnected_at", null);

  for (const conn of due1d ?? []) {
    processed++;
    const result = await sendNotice(svc, conn, "1d", req.nextUrl.origin);
    if (result) sent++; else errors++;
  }

  logger.info("cron.pre_expiry.done", { processed, sent, errors });

  return NextResponse.json(
    { ok: true, data: { processed, sent, errors }, timestamp: now.toISOString() },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// sendNotice — send one pre-expiry email and stamp the sent_at column.
// Returns true on success, false on any failure (logged, non-fatal).
//
// SCOPE GUARD: only writes pre_expiry_*_sent_at — nothing else.
// ---------------------------------------------------------------------------
async function sendNotice(
  svc: ReturnType<typeof getServiceRoleClient>,
  conn: {
    id: string;
    company_id: string;
    platform: string;
    display_name: string | null;
    expires_at: string | null;
  },
  stage: PreExpiryStage,
  origin: string,
): Promise<boolean> {
  try {
    // Resolve recipient: portal_contact_email → primary admin fallback
    const { data: company } = await svc
      .from("platform_companies")
      .select("name, portal_contact_email, portal_contact_name")
      .eq("id", conn.company_id)
      .maybeSingle();

    let recipientEmail: string | null = company?.portal_contact_email ?? null;
    let recipientName: string | null = company?.portal_contact_name ?? null;

    if (!recipientEmail) {
      // Fallback: find primary admin
      const { data: admin } = await svc
        .from("platform_company_users")
        .select("platform_users(id, email, full_name)")
        .eq("company_id", conn.company_id)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      const adminUser = (admin as { platform_users: { email: string; full_name: string | null } | null } | null)
        ?.platform_users;

      if (!adminUser?.email) {
        logger.warn("cron.pre_expiry.no_recipient", {
          connectionId: conn.id, companyId: conn.company_id, stage,
        });
        return false;
      }
      recipientEmail = adminUser.email;
      recipientName = adminUser.full_name ?? null;
    }

    // Issue a portal magic link for this connection (deep-link mode)
    const { rawToken } = await issue({
      purpose: "reconnect",
      subjectType: "social_connection",
      subjectId: conn.id,
      companyId: conn.company_id,
      email: recipientEmail,
    });
    const reconnectUrl = `${origin}/magic-link/reconnect?token=${rawToken}`;

    // Send email
    const { subject, html, text } = renderPortalPreExpiryEmail({
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      company_name: company?.name ?? "Your company",
      platform_display_name: PLATFORM_DISPLAY[conn.platform] ?? conn.platform,
      platform_name: conn.platform,
      expires_at: conn.expires_at,
      stage,
      reconnect_url: reconnectUrl,
    });

    const emailResult = await sendEmail({ to: recipientEmail, subject, html, text });
    if (!emailResult.ok) {
      logger.error("cron.pre_expiry.email_failed", {
        connectionId: conn.id, stage, err: emailResult.error.message,
      });
      return false;
    }

    // Stamp the sent_at column — ONLY this column (scope constraint).
    // Atomic WHERE sent_at IS NULL guard prevents double-sending under concurrent ticks.
    const column = stage === "7d" ? "pre_expiry_7d_sent_at" : "pre_expiry_1d_sent_at";
    const { error: stampErr } = await svc
      .from("social_connections")
      .update({
        [column]: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id)
      .is(column, null); // idempotency guard

    if (stampErr) {
      logger.error("cron.pre_expiry.stamp_failed", {
        connectionId: conn.id, column, err: stampErr.message,
      });
      // Email sent but stamp failed — not fatal; next run will resend but that's acceptable
    }

    logger.info("cron.pre_expiry.sent", {
      connectionId: conn.id, companyId: conn.company_id,
      platform: conn.platform, stage, to: recipientEmail,
    });

    return true;
  } catch (err) {
    logger.error("cron.pre_expiry.unexpected", {
      connectionId: conn.id, stage, err: String(err),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth gate — same CRON_SECRET bearer pattern as all other crons.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return handle(req);
}
