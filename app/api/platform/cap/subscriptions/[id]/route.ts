import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { updateCapSubscriptionObjectiveTemplate } from "@/lib/cap/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const PatchBodySchema = z.object({
  monthly_objective_template: z.string().max(500).nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  let body: z.infer<typeof PatchBodySchema>;
  try {
    body = PatchBodySchema.parse(await req.json());
  } catch {
    return validationError("Invalid request body.");
  }

  try {
    const updated = await updateCapSubscriptionObjectiveTemplate(
      id,
      body.monthly_objective_template,
    );
    return NextResponse.json({ ok: true, data: updated }, { status: 200 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to update subscription.");
  }
}
