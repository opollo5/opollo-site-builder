import type { NextResponse } from "next/server";
import { listComponents } from "@/lib/components";
import { respond, validationError } from "@/lib/http";

// Shared pre-flight check for the POST + PATCH template routes. Mirrors the
// validation the seed script runs (scripts/seed-leadsource.ts): every
// composition[].component must exist in the parent design system's
// components, or we refuse the write.
export async function validateCompositionRefs(
  ds_id: string,
  refs: string[],
): Promise<NextResponse | null> {
  const componentsRes = await listComponents(ds_id);
  if (!componentsRes.ok) return respond(componentsRes);
  const existing = new Set(componentsRes.data.map((c) => c.name));
  const unknown = refs.filter((r) => !existing.has(r));
  if (unknown.length > 0) {
    return validationError(
      `Template composition references component(s) that do not exist in this design system.`,
      {
        design_system_id: ds_id,
        unknown_components: unknown,
      },
    );
  }
  return null;
}
