import "server-only";

import { createHash } from "node:crypto";

import { defaultAnthropicCall, type AnthropicCallFn } from "@/lib/anthropic-call";
import { computeCostCents } from "@/lib/anthropic-pricing";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { gateLlmCall, recordLlmCall } from "../llm-usage";
import type { TestRow, VariantRow } from "./types";

// ---------------------------------------------------------------------------
// Variant generator (Slice 18) — given an APPROVED opt_proposals row,
// produce two opt_variants rows + one opt_tests row in status 'queued':
//
//   - Variant A — change_set verbatim from the proposal (the "approved
//     version we're testing"). The control.
//   - Variant B — a structurally distinct alternative produced via an
//     LLM call. The challenger.
//
// Both variants are submitted to the existing M12/M13 brief-runner via
// the briefs / brief_pages / brief_runs tables. The opt_tests row
// links to both opt_variants rows; Slice 19's monitor moves it to
// 'running' once both variants reach status='ready' AND the static
// files are written, then watches Bayesian winner-probability.
//
// LLM usage:
//   - One call to alternativeChangeSet() for variant B's twist
//   - Cost recorded via lib/optimiser/llm-usage; gated against the
//     client's monthly budget. On block, generation falls back to a
//     deterministic structural transform (swap layout / form length)
//     so testing isn't gated on LLM budget alone.
//
// Phase 1.5 defect note: lib/optimiser/site-builder-bridge/submit-brief.ts
// reads `client.slug` but the actual column is `client_slug`. This
// generator uses the correct column. Filing a separate issue on the
// underlying defect; not in scope for Slice 18.
// ---------------------------------------------------------------------------

const LLM_MODEL = "claude-sonnet-4-6";

export interface CreateVariantPairInput {
  proposalId: string;
  approverUserId: string | null;
  /** 1..99 — percent of traffic going to B. Default 50 (balanced). */
  trafficSplitPercent?: number;
  /** Test injection point. Production uses defaultAnthropicCall. */
  callFn?: AnthropicCallFn;
}

export type CreateVariantPairResult =
  | {
      ok: true;
      variant_a: VariantRow;
      variant_b: VariantRow;
      test: TestRow;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

interface ProposalContext {
  proposal_id: string;
  client_id: string;
  landing_page_id: string;
  headline: string;
  change_set: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  pre_build_reprompt: string | null;
  triggering_playbook_id: string | null;
  page_id: string | null;
  management_mode: string;
  hosting_mode: "opollo_subdomain" | "opollo_cname" | "client_slice";
  client_slug: string;
  site_id: string | null;
}

export async function createVariantPair(
  input: CreateVariantPairInput,
): Promise<CreateVariantPairResult> {
  let context: ProposalContext;
  try {
    context = await loadContext(input.proposalId);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "CONTEXT_LOAD_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Variant B's alternative change_set. Try the LLM path; fall back to
  // a deterministic structural transform if the budget is exhausted.
  const split = input.trafficSplitPercent ?? 50;
  if (split < 1 || split > 99) {
    return {
      ok: false,
      error: {
        code: "INVALID_SPLIT",
        message: `traffic_split_percent must be 1..99, got ${split}`,
      },
    };
  }

  const variantB = await proposeAlternative(context, input.callFn);

  // Persist variant rows + brief submissions in two passes. We submit
  // briefs first (so we have brief_id / brief_run_id to record), then
  // create opt_tests pointing at both.
  const supabase = getServiceRoleClient();

  // Variant A (control — change_set verbatim).
  const aBrief = await submitVariantBrief({
    context,
    variantLabel: "A",
    changeSet: context.change_set,
    notes: "Control — change set verbatim from approved proposal.",
    approverUserId: input.approverUserId,
  });
  if (!aBrief.ok) {
    return {
      ok: false,
      error: { code: "VARIANT_A_BRIEF_FAILED", message: aBrief.message },
    };
  }
  const variantARow = await insertVariantRow(supabase, {
    context,
    label: "A",
    brief_id: aBrief.brief_id,
    brief_run_id: aBrief.brief_run_id,
    change_set: context.change_set,
    generation_notes: "Control — change set verbatim from approved proposal.",
    created_by: input.approverUserId,
  });

  // Variant B (challenger — alternative change_set).
  const bBrief = await submitVariantBrief({
    context,
    variantLabel: "B",
    changeSet: variantB.changeSet,
    notes: variantB.notes,
    approverUserId: input.approverUserId,
  });
  if (!bBrief.ok) {
    // Best-effort cleanup: A is already inserted, leave it for the
    // operator to re-attempt. Returning the error so the caller can
    // log + surface.
    return {
      ok: false,
      error: { code: "VARIANT_B_BRIEF_FAILED", message: bBrief.message },
    };
  }
  const variantBRow = await insertVariantRow(supabase, {
    context,
    label: "B",
    brief_id: bBrief.brief_id,
    brief_run_id: bBrief.brief_run_id,
    change_set: variantB.changeSet,
    generation_notes: variantB.notes,
    created_by: input.approverUserId,
  });

  // opt_tests row — status 'queued' until both variants reach 'ready'
  // and the static files are written; the activation step (Slice 18
  // also ships an /activate route + writer) flips to 'running'.
  const { data: testRow, error: testErr } = await supabase
    .from("opt_tests")
    .insert({
      client_id: context.client_id,
      landing_page_id: context.landing_page_id,
      source_proposal_id: context.proposal_id,
      variant_a_id: variantARow.id,
      variant_b_id: variantBRow.id,
      traffic_split_percent: split,
      status: "queued",
    })
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_a_id, variant_b_id, traffic_split_percent, status, min_sessions, min_conversions, winner_probability_a, winner_probability_b, last_metrics_snapshot, last_evaluated_at, started_at, ended_at, ended_reason, created_at, updated_at",
    )
    .single();
  if (testErr || !testRow) {
    return {
      ok: false,
      error: {
        code: "TEST_INSERT_FAILED",
        message: testErr?.message ?? "no row",
      },
    };
  }

  return {
    ok: true,
    variant_a: variantARow,
    variant_b: variantBRow,
    test: testRow as TestRow,
  };
}

async function loadContext(proposalId: string): Promise<ProposalContext> {
  const supabase = getServiceRoleClient();
  const proposalRes = await supabase
    .from("opt_proposals")
    .select(
      "id, client_id, landing_page_id, headline, change_set, before_snapshot, pre_build_reprompt, triggering_playbook_id, status",
    )
    .eq("id", proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (proposalRes.error) throw new Error(proposalRes.error.message);
  if (!proposalRes.data) throw new Error("proposal not found");
  if (proposalRes.data.status !== "approved" && proposalRes.data.status !== "applied") {
    throw new Error(
      `proposal status must be approved or applied to start an A/B test, got ${proposalRes.data.status}`,
    );
  }
  const landingRes = await supabase
    .from("opt_landing_pages")
    .select("id, management_mode, page_id")
    .eq("id", proposalRes.data.landing_page_id as string)
    .maybeSingle();
  if (landingRes.error) throw new Error(landingRes.error.message);
  if (!landingRes.data) throw new Error("landing page not found");

  const clientRes = await supabase
    .from("opt_clients")
    .select("id, client_slug, hosting_mode")
    .eq("id", proposalRes.data.client_id as string)
    .maybeSingle();
  if (clientRes.error) throw new Error(clientRes.error.message);
  if (!clientRes.data) throw new Error("client not found");

  let siteId: string | null = null;
  if (landingRes.data.page_id) {
    const pageRes = await supabase
      .from("pages")
      .select("site_id")
      .eq("id", landingRes.data.page_id as string)
      .maybeSingle();
    if (pageRes.error) throw new Error(pageRes.error.message);
    siteId = (pageRes.data?.site_id as string | undefined) ?? null;
  }

  return {
    proposal_id: proposalRes.data.id as string,
    client_id: proposalRes.data.client_id as string,
    landing_page_id: proposalRes.data.landing_page_id as string,
    headline: proposalRes.data.headline as string,
    change_set: (proposalRes.data.change_set ?? {}) as Record<string, unknown>,
    before_snapshot: (proposalRes.data.before_snapshot ?? {}) as Record<
      string,
      unknown
    >,
    pre_build_reprompt:
      (proposalRes.data.pre_build_reprompt as string | null) ?? null,
    triggering_playbook_id:
      (proposalRes.data.triggering_playbook_id as string | null) ?? null,
    page_id: (landingRes.data.page_id as string | null) ?? null,
    management_mode: landingRes.data.management_mode as string,
    hosting_mode: clientRes.data.hosting_mode as
      | "opollo_subdomain"
      | "opollo_cname"
      | "client_slice",
    client_slug: clientRes.data.client_slug as string,
    site_id: siteId,
  };
}

async function proposeAlternative(
  context: ProposalContext,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<{ changeSet: Record<string, unknown>; notes: string }> {
  const gate = await gateLlmCall(context.client_id, "variant_generation");
  if (gate === "block") {
    return deterministicAlternative(context);
  }
  try {
    const system = `You design A/B test variants for landing pages. Given the approved (A) change set, produce a structurally DIFFERENT alternative (B) — different hero composition, different CTA placement, different form length, different proof-element layout, etc. The B version must be a meaningfully different test of the same hypothesis, not a copy tweak.

Output JSON only with this shape:
{
  "change_set": <object — same shape as the input change_set; describes the alternative>,
  "notes": "<one sentence: what makes this structurally distinct from A>"
}`;
    const user = `Approved change set (variant A):\n\n\`\`\`json\n${JSON.stringify(
      context.change_set,
      null,
      2,
    )}\n\`\`\`\n\nProduce variant B per the rubric. JSON only.`;
    const idempotencyKey = `optimiser:variant-b:${context.proposal_id}`;
    const response = await callFn({
      model: LLM_MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: user }],
      idempotency_key: idempotencyKey,
    });
    const { cents } = computeCostCents(response.model, response.usage);
    await recordLlmCall({
      clientId: context.client_id,
      caller: "variant_generation",
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsdMicros: cents * 10_000,
      anthropicRequestId: response.id,
      sourceTable: "opt_proposals",
      sourceId: context.proposal_id,
    });
    const text = response.content.map((b) => b.text).join("\n").trim();
    const parsed = parseJson(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "change_set" in parsed &&
      typeof (parsed as { change_set: unknown }).change_set === "object"
    ) {
      const obj = parsed as { change_set: Record<string, unknown>; notes?: unknown };
      return {
        changeSet: obj.change_set,
        notes:
          typeof obj.notes === "string"
            ? obj.notes.slice(0, 280)
            : "LLM-proposed alternative.",
      };
    }
    logger.warn("optimiser.variant.llm_parse_failed", {
      proposal_id: context.proposal_id,
      response_id: response.id,
      raw: text.slice(0, 200),
    });
    return deterministicAlternative(context);
  } catch (err) {
    logger.warn("optimiser.variant.llm_call_failed", {
      proposal_id: context.proposal_id,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordLlmCall({
      clientId: context.client_id,
      caller: "variant_generation",
      model: LLM_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
      outcome: "error",
      errorCode: "LLM_ERROR",
    });
    return deterministicAlternative(context);
  }
}

/**
 * Deterministic fallback when LLM is unavailable. Emits a change set
 * with a labeled `_variant_b_twist` field so the brief-runner has a
 * marker for "this is the alternative" — and the visual review pass
 * has something different enough to compose against.
 *
 * Phase 2 ships three baseline twists rotated by playbook id; Phase 3
 * may calibrate the rotation against winning-variant data once the
 * pattern library is populated.
 */
function deterministicAlternative(context: ProposalContext): {
  changeSet: Record<string, unknown>;
  notes: string;
} {
  const seed = createHash("sha256").update(context.proposal_id).digest();
  const variantNumber = seed.readUInt8(0) % 3;
  const twists = [
    {
      label: "centred_hero_with_long_form",
      notes:
        "Centred hero composition with longer form — opposite of the typical left-aligned + minimal-form A baseline.",
    },
    {
      label: "trust_first_above_offer",
      notes:
        "Trust signals (testimonial / logos / certifications) anchored above the offer; offer restated within the form area.",
    },
    {
      label: "two_step_form_with_progress_indicator",
      notes:
        "Form split into two steps with a visible progress indicator; first step asks only for email + name.",
    },
  ];
  const twist = twists[variantNumber];
  return {
    changeSet: {
      ...context.change_set,
      _variant_b_twist: twist.label,
    },
    notes: `Deterministic fallback (LLM unavailable): ${twist.notes}`,
  };
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        // fall through
      }
    }
  }
  return null;
}

interface SubmitVariantBriefArgs {
  context: ProposalContext;
  variantLabel: "A" | "B";
  changeSet: Record<string, unknown>;
  notes: string | null;
  approverUserId: string | null;
}

type SubmitVariantBriefResult =
  | { ok: true; brief_id: string; brief_run_id: string }
  | { ok: false; message: string };

async function submitVariantBrief(
  args: SubmitVariantBriefArgs,
): Promise<SubmitVariantBriefResult> {
  const supabase = getServiceRoleClient();
  const outputMode: "slice" | "full_page" =
    args.context.hosting_mode === "client_slice" ? "slice" : "full_page";

  const sourceText = renderVariantBriefText(args);
  const sha = createHash("sha256").update(sourceText).digest("hex");
  const idempotencyKey = `optimiser:variant:${args.context.proposal_id}:${args.variantLabel}`;

  let briefId: string | null = null;
  try {
    const { data: brief, error: bErr } = await supabase
      .from("briefs")
      .insert({
        site_id: args.context.site_id,
        title: `Optimiser A/B [${args.variantLabel}]: ${args.context.headline}`,
        status: "committed",
        source_storage_path: `optimiser-virtual/${args.context.proposal_id}-${args.variantLabel}`,
        source_mime_type: "text/markdown",
        source_size_bytes: Buffer.byteLength(sourceText, "utf8"),
        source_sha256: sha,
        upload_idempotency_key: idempotencyKey,
        parser_mode: "structural",
        parser_warnings: [],
        committed_at: new Date().toISOString(),
        committed_by: args.approverUserId,
        committed_page_hash: sha,
        created_by: args.approverUserId,
        updated_by: args.approverUserId,
      })
      .select("id")
      .single();
    if (bErr || !brief) {
      throw new Error(`briefs insert: ${bErr?.message ?? "no row"}`);
    }
    briefId = brief.id as string;

    const wordCount = sourceText.split(/\s+/).filter((s) => s.length > 0).length;
    const { error: pErr } = await supabase.from("brief_pages").insert({
      brief_id: briefId,
      ordinal: 0,
      title: `${args.context.headline} (variant ${args.variantLabel})`,
      mode: "full_text",
      source_text: sourceText,
      word_count: wordCount,
      output_mode: outputMode,
      operator_notes: args.notes,
      created_by: args.approverUserId,
      updated_by: args.approverUserId,
    });
    if (pErr) throw new Error(`brief_pages insert: ${pErr.message}`);

    const { data: run, error: rErr } = await supabase
      .from("brief_runs")
      .insert({
        brief_id: briefId,
        status: "queued",
        triggered_by_proposal_id: args.context.proposal_id,
        created_by: args.approverUserId,
        updated_by: args.approverUserId,
      })
      .select("id")
      .single();
    if (rErr || !run) throw new Error(`brief_runs insert: ${rErr?.message ?? "no row"}`);

    return { ok: true, brief_id: briefId, brief_run_id: run.id as string };
  } catch (err) {
    if (briefId) {
      try {
        await supabase.from("briefs").delete().eq("id", briefId);
      } catch (cleanupErr) {
        logger.error("optimiser.variant.cleanup_failed", {
          brief_id: briefId,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderVariantBriefText(args: SubmitVariantBriefArgs): string {
  const lines: string[] = [
    `# ${args.context.headline} (variant ${args.variantLabel})`,
    "",
    "## Optimisation context",
    "",
    `- Proposal id: ${args.context.proposal_id}`,
    `- Triggering playbook: ${args.context.triggering_playbook_id ?? "(none)"}`,
    `- Variant: ${args.variantLabel}`,
    "",
    "## Change set",
    "",
    "```json",
    JSON.stringify(args.changeSet, null, 2),
    "```",
    "",
    "## Before snapshot",
    "",
    "```json",
    JSON.stringify(args.context.before_snapshot, null, 2),
    "```",
  ];
  if (args.context.pre_build_reprompt) {
    lines.push(
      "",
      "## Operator notes (pre-build reprompt)",
      "",
      args.context.pre_build_reprompt,
    );
  }
  if (args.notes) {
    lines.push(
      "",
      "## Variant notes",
      "",
      args.notes,
    );
  }
  return lines.join("\n");
}

interface InsertVariantRowArgs {
  context: ProposalContext;
  label: "A" | "B";
  brief_id: string;
  brief_run_id: string;
  change_set: Record<string, unknown>;
  generation_notes: string;
  created_by: string | null;
}

async function insertVariantRow(
  supabase: ReturnType<typeof getServiceRoleClient>,
  args: InsertVariantRowArgs,
): Promise<VariantRow> {
  const { data, error } = await supabase
    .from("opt_variants")
    .insert({
      client_id: args.context.client_id,
      landing_page_id: args.context.landing_page_id,
      source_proposal_id: args.context.proposal_id,
      variant_label: args.label,
      brief_id: args.brief_id,
      brief_run_id: args.brief_run_id,
      change_set: args.change_set,
      generation_notes: args.generation_notes,
      status: "generating",
      created_by: args.created_by,
    })
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_label, brief_id, brief_run_id, page_version, change_set, generation_notes, status, generated_at, failed_reason, created_at, updated_at, created_by",
    )
    .single();
  if (error || !data) {
    throw new Error(
      `insertVariantRow ${args.label}: ${error?.message ?? "no row"}`,
    );
  }
  return data as VariantRow;
}
