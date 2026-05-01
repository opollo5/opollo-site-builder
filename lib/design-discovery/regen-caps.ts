import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY-FOLLOWUP — server-side regeneration caps.
//
// Each setup-wizard regeneration loop (concept refinement / tone
// sample regeneration) is capped at 10 calls per site. Pre-this-PR
// the cap lived in client state only; this module moves enforcement
// to the server and lets the routes return 429 the moment the cap
// is hit.
//
// Storage: sites.regeneration_counts JSONB
//   { concept_refinements: number, tone_samples: number }
// Schema: migration 0066.
// ---------------------------------------------------------------------------

export type RegenCounter = "concept_refinements" | "tone_samples";

export const REGEN_CAP = 10;

export type IncrementResult =
  | { ok: true; current: number }
  | {
      ok: false;
      error: {
        code: "NOT_FOUND" | "LIMIT_REACHED" | "INTERNAL_ERROR";
        message: string;
        current?: number;
      };
    };

const COUNTER_LABEL: Record<RegenCounter, string> = {
  concept_refinements: "Refinement",
  tone_samples: "Sample regeneration",
};

interface CountsRow {
  regeneration_counts: Record<string, number> | null;
}

function readCount(
  raw: Record<string, unknown> | null,
  key: RegenCounter,
): number {
  if (!raw) return 0;
  const v = raw[key];
  return typeof v === "number" && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Atomic-enough increment: read the current value, refuse if at cap,
 * write the new bucket back. The race window is bounded — a single
 * operator drives one site through the wizard — and the worst case is
 * one extra call slipping through during a same-millisecond double
 * post, which is fine as long as the schema-level CHECK keeps the
 * value non-negative.
 */
export async function incrementRegenCount(
  siteId: string,
  counter: RegenCounter,
): Promise<IncrementResult> {
  const supabase = getServiceRoleClient();
  const { data: row, error: readErr } = await supabase
    .from("sites")
    .select("regeneration_counts")
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle<CountsRow>();
  if (readErr) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: readErr.message },
    };
  }
  if (!row) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${siteId}.`,
      },
    };
  }
  const counts = (row.regeneration_counts ?? {}) as Record<string, unknown>;
  const current = readCount(counts, counter);
  if (current >= REGEN_CAP) {
    const label = COUNTER_LABEL[counter];
    const reset =
      counter === "concept_refinements"
        ? "Reset your design direction to start over."
        : "Reset your tone of voice to start over.";
    return {
      ok: false,
      error: {
        code: "LIMIT_REACHED",
        message: `${label} limit reached (${current}/${REGEN_CAP}). ${reset}`,
        current,
      },
    };
  }
  const nextCounts: Record<string, number> = {};
  for (const k of Object.keys(counts)) {
    nextCounts[k] = readCount(counts, k as RegenCounter);
  }
  nextCounts[counter] = current + 1;
  const { data: updated, error: writeErr } = await supabase
    .from("sites")
    .update({
      regeneration_counts: nextCounts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (writeErr) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: writeErr.message },
    };
  }
  if (!updated) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Site ${siteId} disappeared during increment.`,
      },
    };
  }
  return { ok: true, current: current + 1 };
}

export type ResetResult =
  | { ok: true }
  | {
      ok: false;
      error: { code: "NOT_FOUND" | "INTERNAL_ERROR"; message: string };
    };

/**
 * Zero one of the two buckets. Used by:
 *   - DELETE /setup/approve-design ("Reset and start over" on Step 1) →
 *     resets concept_refinements
 *   - POST /setup/extract-tone (re-extraction wipes the existing tone +
 *     samples) → resets tone_samples
 */
export async function resetRegenCount(
  siteId: string,
  counter: RegenCounter,
): Promise<ResetResult> {
  const supabase = getServiceRoleClient();
  const { data: row, error: readErr } = await supabase
    .from("sites")
    .select("regeneration_counts")
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle<CountsRow>();
  if (readErr) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: readErr.message },
    };
  }
  if (!row) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${siteId}.`,
      },
    };
  }
  const counts = (row.regeneration_counts ?? {}) as Record<string, unknown>;
  const next: Record<string, number> = {};
  for (const k of Object.keys(counts)) {
    next[k] = readCount(counts, k as RegenCounter);
  }
  next[counter] = 0;
  const { data: updated, error: writeErr } = await supabase
    .from("sites")
    .update({
      regeneration_counts: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (writeErr) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: writeErr.message },
    };
  }
  if (!updated) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Site ${siteId} disappeared during reset.`,
      },
    };
  }
  return { ok: true };
}

export async function getRegenCounts(
  siteId: string,
): Promise<
  | { ok: true; counts: Record<RegenCounter, number> }
  | { ok: false; error: { code: string; message: string } }
> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select("regeneration_counts")
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle<CountsRow>();
  if (error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${siteId}.`,
      },
    };
  }
  const counts = (data.regeneration_counts ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    counts: {
      concept_refinements: readCount(counts, "concept_refinements"),
      tone_samples: readCount(counts, "tone_samples"),
    },
  };
}
