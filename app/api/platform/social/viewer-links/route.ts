import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createViewerLink, listViewerLinks } from "@/lib/platform/social/viewer-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: dbUuid(),
  recipient_email: z.string().email().max(254).nullable().optional(),
  recipient_name: z.string().max(200).nullable().optional(),
  expires_at: z.string().datetime().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }
  const includeInactive = url.searchParams.get("include_inactive") === "true";

  const gate = await requireCanDoForApi(companyId, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await listViewerLinks({ companyId, includeInactive });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, recipient_email?, recipient_name?, expires_at? }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await createViewerLink({
    companyId: parsed.data.company_id,
    recipientEmail: parsed.data.recipient_email ?? null,
    recipientName: parsed.data.recipient_name ?? null,
    expiresAt: parsed.data.expires_at,
    createdBy: gate.userId,
  });
  if (!result.ok) return respond(result);

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const viewerUrl = `${origin}/viewer/${result.data.rawToken}`;

  return NextResponse.json(
    { ok: true, data: { link: result.data.link, url: viewerUrl }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
