import { NextResponse } from "next/server";

import { createSite } from "@/lib/sites";
import {
  RegisterSiteInputSchema,
  errorCodeToStatus,
  type ApiResponse,
  type SiteRecord,
} from "@/lib/tool-schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = RegisterSiteInputSchema.safeParse(body);
  if (!parsed.success) {
    const response: ApiResponse<SiteRecord> = {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Input failed schema validation.",
        details: { issues: parsed.error.issues },
        retryable: true,
        suggested_action:
          "Fix the listed fields and re-submit. prefix must match /^[a-z0-9]{2,4}$/.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 400 });
  }

  const result = await createSite(parsed.data);
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
