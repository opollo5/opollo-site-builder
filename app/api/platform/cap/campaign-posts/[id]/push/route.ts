import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { pushCapPostToComposer } from "@/lib/cap/push-to-composer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const result = await pushCapPostToComposer(id, gate.userId);
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to push post to composer");
  }
}
