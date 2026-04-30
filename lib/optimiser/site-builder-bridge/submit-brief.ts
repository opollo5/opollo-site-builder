import "server-only";

import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 15 — Brief submission bridge.
//
// Given an APPROVED opt_proposals row, construct a brief + brief_pages
// + brief_runs triple in the Site Builder schema and link the run
// back to the proposal via brief_runs.triggered_by_proposal_id.
//
// The brief-runner cron (existing) picks up the queued brief_run on
// its next tick and starts the multi-pass loop. Slice 14's
// composeFullPage + writeStaticPage are the consumers; the brief-
// runner integration is a follow-up sub-slice once the operator gate
// has confirmed the bridge produces correctly-shaped briefs.
//
// Hosting-mode routing:
//   - opt_clients.hosting_mode === 'opollo_subdomain' or
//     'opollo_cname'  → brief_pages.output_mode = 'full_page'
//   - opt_clients.hosting_mode === 'client_slice'      → 'slice'
//
// The `slice` path preserves backward compatibility with sites that
// publish into a WordPress install controlled by the client; the
// `full_page` path produces a self-contained HTML doc written to
// SiteGround.
//
// On any failure the bridge:
//   - Returns a typed error result without mutating the proposal row
//     (the approveProposal caller decides whether to revert status).
//   - Best-effort cleanup of any partially-inserted brief rows so a
//     retry doesn't accumulate orphaned rows.
// ---------------------------------------------------------------------------

export interface SubmitBriefInput {
  proposalId: string;
  approverUserId: string | null;
}

export type SubmitBriefResult =
  | {
      ok: true;
      brief_id: string;
      brief_run_id: string;
      output_mode: "slice" | "full_page";
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
  // Joined from opt_landing_pages
  page_id: string | null;
  management_mode: string;
  // Joined from opt_clients
  hosting_mode: "opollo_subdomain" | "opollo_cname" | "client_slice";
  client_slug: string;
  // Joined from sites (via opt_landing_pages.page_id → pages.site_id)
  site_id: string | null;
}

export async function submitBriefForProposal(
  input: SubmitBriefInput,
): Promise<SubmitBriefResult> {
  let context: ProposalContext;
  try {
    context = await loadProposalContext(input.proposalId);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "PROPOSAL_CONTEXT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (context.management_mode !== "full_automation" || context.page_id === null) {
    return {
      ok: false,
      error: {
        code: "PAGE_NOT_AUTOMATED",
        message:
          "Landing page is not in full_automation mode. Use the manual rebuild fallback or run page-import (Slice 17) first.",
      },
    };
  }
  if (context.site_id === null) {
    return {
      ok: false,
      error: {
        code: "SITE_LOOKUP_FAILED",
        message: "Could not resolve site_id for the landing page's WP page.",
      },
    };
  }

  const outputMode: "slice" | "full_page" =
    context.hosting_mode === "client_slice" ? "slice" : "full_page";
  const briefSourceText = renderBriefSourceText(context);
  const sourceSha = createHash("sha256").update(briefSourceText).digest("hex");
  const idempotencyKey = `optimiser:proposal:${context.proposal_id}`;

  const supabase = getServiceRoleClient();
  let briefId: string | null = null;
  try {
    // 1. briefs row (status=committed; this is a programmatic brief,
    //    not an operator upload, so we skip the parsing dance).
    const { data: briefRow, error: briefErr } = await supabase
      .from("briefs")
      .insert({
        site_id: context.site_id,
        title: `Optimiser: ${context.headline}`,
        status: "committed",
        source_storage_path: `optimiser-virtual/${context.proposal_id}`,
        source_mime_type: "text/markdown",
        source_size_bytes: Buffer.byteLength(briefSourceText, "utf8"),
        source_sha256: sourceSha,
        upload_idempotency_key: idempotencyKey,
        parser_mode: "structural",
        parser_warnings: [],
        committed_at: new Date().toISOString(),
        committed_by: input.approverUserId,
        committed_page_hash: sourceSha,
        created_by: input.approverUserId,
        updated_by: input.approverUserId,
      })
      .select("id")
      .single();
    if (briefErr || !briefRow) {
      throw new Error(`briefs insert: ${briefErr?.message ?? "no row"}`);
    }
    briefId = briefRow.id as string;

    // 2. brief_pages — single page, ordinal 0, output_mode routed.
    const wordCount = briefSourceText
      .split(/\s+/)
      .filter((s) => s.length > 0).length;
    const { error: pageErr } = await supabase.from("brief_pages").insert({
      brief_id: briefId,
      ordinal: 0,
      title: context.headline,
      mode: "full_text",
      source_text: briefSourceText,
      word_count: wordCount,
      output_mode: outputMode,
      operator_notes: context.pre_build_reprompt,
      created_by: input.approverUserId,
      updated_by: input.approverUserId,
    });
    if (pageErr) {
      throw new Error(`brief_pages insert: ${pageErr.message}`);
    }

    // 3. brief_runs — queued, link back to proposal so slice-15's
    //    sync helper + slice-16's monitor can find it.
    const { data: runRow, error: runErr } = await supabase
      .from("brief_runs")
      .insert({
        brief_id: briefId,
        status: "queued",
        triggered_by_proposal_id: context.proposal_id,
        created_by: input.approverUserId,
        updated_by: input.approverUserId,
      })
      .select("id")
      .single();
    if (runErr || !runRow) {
      throw new Error(`brief_runs insert: ${runErr?.message ?? "no row"}`);
    }

    return {
      ok: true,
      brief_id: briefId,
      brief_run_id: runRow.id as string,
      output_mode: outputMode,
    };
  } catch (err) {
    // Best-effort cleanup. brief_pages + brief_runs cascade off briefs,
    // so deleting the brief row sweeps everything.
    if (briefId !== null) {
      try {
        await supabase.from("briefs").delete().eq("id", briefId);
      } catch (cleanupErr) {
        logger.error("submit-brief: cleanup delete failed", {
          brief_id: briefId,
          err:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }
    return {
      ok: false,
      error: {
        code: "BRIEF_INSERT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function loadProposalContext(
  proposalId: string,
): Promise<ProposalContext> {
  const supabase = getServiceRoleClient();

  // Three reads — proposal, landing-page (with optional page join),
  // and client. Three round-trips is acceptable; this runs once per
  // approve, not per request hot-path.
  const proposalRes = await supabase
    .from("opt_proposals")
    .select(
      "id, client_id, landing_page_id, headline, change_set, before_snapshot, pre_build_reprompt, triggering_playbook_id",
    )
    .eq("id", proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (proposalRes.error) throw new Error(proposalRes.error.message);
  if (!proposalRes.data) throw new Error("proposal not found");

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

  // Resolve site_id: opt_landing_pages.page_id → pages.site_id.
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

// Render the brief's source_text. The brief-runner reads this verbatim
// as the generation input. Markdown shape so the existing Anthropic
// prompt patterns ingest it cleanly.
function renderBriefSourceText(context: ProposalContext): string {
  const lines: string[] = [
    `# ${context.headline}`,
    "",
    "## Optimisation context",
    "",
    `- Proposal id: ${context.proposal_id}`,
    `- Triggering playbook: ${context.triggering_playbook_id ?? "(none)"}`,
    "",
    "## Change set",
    "",
    "```json",
    JSON.stringify(context.change_set, null, 2),
    "```",
    "",
    "## Before snapshot",
    "",
    "```json",
    JSON.stringify(context.before_snapshot, null, 2),
    "```",
  ];
  if (context.pre_build_reprompt) {
    lines.push(
      "",
      "## Operator notes (pre-build reprompt)",
      "",
      context.pre_build_reprompt,
    );
  }
  return lines.join("\n");
}
