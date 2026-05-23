import { type NextRequest, NextResponse } from "next/server";

import { authorisedCronRequest, unauthorisedResponse } from "@/lib/platform/cron/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Back-compat endpoint — wraps /api/insights/generation-priors and returns only priors_text.
// PR #997 consumers that only need the priors_text field can call this endpoint
// without updating to the full v1 contract shape.
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  const platform = searchParams.get("platform") ?? "LINKEDIN";

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const fullUrl = `${base}/api/insights/generation-priors?company_id=${encodeURIComponent(companyId ?? "")}&platform=${encodeURIComponent(platform)}`;

  try {
    const cronSecret = process.env.CRON_SECRET ?? "";
    const upstream = await fetch(fullUrl, {
      headers: { "X-Cron-Secret": cronSecret },
      signal: AbortSignal.timeout(240),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, priors_text: "", error: data.error },
        { status: upstream.status },
      );
    }

    return NextResponse.json({ ok: true, priors_text: data.priors_text ?? "" });
  } catch {
    return NextResponse.json({ ok: true, priors_text: "" });
  }
}
