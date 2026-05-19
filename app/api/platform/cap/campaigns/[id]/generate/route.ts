import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { runCampaign } from "@/lib/cap/generation/campaign-runner";
import { CostCapExceededError } from "@/lib/cap/cost-cap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  try {
    const result = await runCampaign(id);
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "COST_CAP_EXCEEDED",
            message: err.message,
            retryable: false,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
    return internalError(err instanceof Error ? err.message : "Generation failed");
  }
}
