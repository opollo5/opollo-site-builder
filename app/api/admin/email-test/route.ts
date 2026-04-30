import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderBaseEmail } from "@/lib/email/templates/base";
import { isEmailTestAllowed } from "@/lib/email-test-gate";

// AUTH-FOUNDATION P1.2 + P1-FIX — POST /api/admin/email-test.
//
// Backs /admin/email-test. Host-aware gate (allowed on local dev,
// Vercel preview, and the staging *.vercel.app alias; blocked on prod
// custom domains); admin/operator gate behind that. Phase 3 will
// replace the host gate with a super_admin role check.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    to: z.string().email().max(320),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(8000),
  })
  .strict();

function deny(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEmailTestAllowed()) {
    return deny(
      "NOT_AVAILABLE_ON_THIS_HOST",
      "Email-test endpoint is not available on production custom domains.",
      404,
    );
  }

  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  let parsed: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    parsed = BodySchema.parse(json);
  } catch (err) {
    return deny(
      "VALIDATION_FAILED",
      err instanceof Error ? err.message : "Invalid request body.",
      400,
    );
  }

  const { html, text } = renderBaseEmail({
    heading: parsed.subject,
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">${escape(parsed.body)}</p>`,
    bodyText: parsed.body,
    footerNote:
      "This is a P1 smoke-test email triggered from /admin/email-test.",
  });

  const result = await sendEmail({
    to: parsed.to,
    subject: parsed.subject,
    html,
    text,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true, messageId: result.messageId });
  }
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.error.code === "SENDGRID_REJECTED" ? 400 : 502 },
  );
}

function escape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
