import "server-only";

import { createHash } from "node:crypto";

import {
  listAppearanceEventsForSite,
  logAppearanceEvent,
  type AppearanceEventRow,
} from "@/lib/appearance-events";
import {
  buildPaletteProposalFromTokensCss,
  diffPalette,
  type KadencePaletteProposal,
  type PaletteDiff,
} from "@/lib/kadence-mapper";
import {
  getKadenceInstallState,
  getKadencePalette,
  putKadencePalette,
  serializeKadencePalette,
  type KadenceInstallState,
  type KadencePalette,
  type KadencePaletteEntry,
} from "@/lib/kadence-rest";
import { logger } from "@/lib/logger";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";
import type { WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-5c — palette sync orchestration.
//
// Glues together:
//   - lib/kadence-rest (read + write WP)
//   - lib/kadence-mapper (parse DS, build proposal, compute diff)
//   - lib/appearance-events (audit log)
//   - lib/sites (credentials + CAS on sites.version_lock)
//
// Every write path:
//   1. Checks Kadence is active. If not, returns KADENCE_NOT_ACTIVE.
//   2. (Opportunistic) Stamps sites.kadence_installed_at on first
//      confirmed detection.
//   3. Runs the write under sites.version_lock CAS.
//   4. Writes an audit event for success AND failure.
//
// Write-safety invariants pinned here:
//   - Dry-run is always previewable before confirm. dryRunPaletteSync
//     makes zero mutations anywhere.
//   - Drift detection: confirmed path re-reads current palette, hashes
//     it, compares against caller-supplied current_palette_sha. Hash
//     mismatch → WP_STATE_DRIFTED, no write.
//   - Idempotency: empty diff short-circuits to ALREADY_SYNCED.
//   - Snapshot-before-write: every globals_completed event's
//     details.previous_palette carries the full pre-image for rollback.
//   - Rollback idempotency: if current WP palette matches the snapshot
//     already, rollback returns ALREADY_ROLLED_BACK without a WP write.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Drift hash — deterministic sha256 of a sorted-slug palette.
// ---------------------------------------------------------------------------

/**
 * Compute a stable sha256 hex digest of a KadencePalette's slot
 * entries. Sorts by slug before serialising so slot order doesn't
 * affect the hash. Upper-cases hex colors so case-drift between WP's
 * sanitisation and our canonical form doesn't change the digest.
 */
export function hashPalette(palette: KadencePalette): string {
  const normalized = [...palette.palette]
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      color: p.color.toUpperCase(),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

/**
 * Same hash over a proposal's slots (not a KadencePalette). Used to
 * confirm the proposal-to-write matches what the operator dry-ran.
 */
export function hashProposalSlots(slots: KadencePaletteEntry[]): string {
  const wrapped: KadencePalette = { palette: slots, source: "populated" };
  return hashPalette(wrapped);
}

// ---------------------------------------------------------------------------
// Context fetch — reused across preflight / dry-run / confirmed / rollback
// ---------------------------------------------------------------------------

export type PaletteSyncContext = {
  site_id: string;
  site_version_lock: number;
  site_wp_url: string;
  cfg: WpConfig;
  install: KadenceInstallState;
  current_palette: KadencePalette;
  current_palette_sha: string;
  proposal: KadencePaletteProposal;
  diff: PaletteDiff;
};

export type PaletteSyncContextResult =
  | { ok: true; ctx: PaletteSyncContext }
  | {
      ok: false;
      code:
        | "SITE_NOT_FOUND"
        | "SITE_CONFIG_MISSING"
        | "DS_NOT_FOUND"
        | "KADENCE_NOT_ACTIVE"
        | "WP_REST_UNREACHABLE"
        | "WP_AUTH_FAILED"
        | "INTERNAL_ERROR";
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Collect everything a dry-run / confirm / rollback needs. Runs all
 * reads in parallel where possible. No writes, no audit. Routes call
 * this first, then branch on the result.
 */
export async function buildPaletteSyncContext(
  site_id: string,
): Promise<PaletteSyncContextResult> {
  const svc = getServiceRoleClient();
  const siteRes = await getSite(site_id, { includeCredentials: true });
  if (!siteRes.ok) {
    if (siteRes.error.code === "NOT_FOUND") {
      return {
        ok: false,
        code: "SITE_NOT_FOUND",
        message: siteRes.error.message,
      };
    }
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: siteRes.error.message,
    };
  }
  const siteRow = siteRes.data.site as {
    id: string;
    wp_url: string;
    prefix: string;
  };
  const creds = siteRes.data.credentials;
  if (!creds) {
    return {
      ok: false,
      code: "SITE_CONFIG_MISSING",
      message:
        "Site has no stored WP credentials. Add them in site settings before syncing.",
    };
  }
  const cfg: WpConfig = {
    baseUrl: siteRow.wp_url,
    user: creds.wp_user,
    appPassword: creds.wp_app_password,
  };

  // SiteRecord (the public shape returned by getSite) doesn't carry
  // version_lock — we read it directly for the CAS write later.
  const versionRes = await svc
    .from("sites")
    .select("version_lock")
    .eq("id", site_id)
    .single();
  if (versionRes.error || !versionRes.data) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Failed to read site version_lock.",
    };
  }
  const site_version_lock = versionRes.data.version_lock as number;

  // Active DS — tokens_css drives the proposal.
  const dsRes = await svc
    .from("design_systems")
    .select("tokens_css")
    .eq("site_id", site_id)
    .eq("status", "active")
    .maybeSingle();
  if (dsRes.error) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: dsRes.error.message,
    };
  }
  if (!dsRes.data) {
    return {
      ok: false,
      code: "DS_NOT_FOUND",
      message:
        "No active design system for this site. Activate one in the DS admin before syncing palette to Kadence.",
    };
  }

  // Kadence install state + current palette — parallel WP reads.
  const [installRes, paletteRes] = await Promise.all([
    getKadenceInstallState(cfg),
    getKadencePalette(cfg),
  ]);
  if (!installRes.ok) {
    return mapWpErrorToContext(installRes);
  }
  if (!paletteRes.ok) {
    return mapWpErrorToContext(paletteRes);
  }

  if (!installRes.kadence_active) {
    return {
      ok: false,
      code: "KADENCE_NOT_ACTIVE",
      message:
        "Kadence is not the active theme. Install and activate Kadence through WP Admin → Appearance → Themes, then return here.",
      details: {
        kadence_installed: installRes.kadence_installed,
        active_theme_slug: installRes.active_theme_slug,
      },
    };
  }

  const proposal = buildPaletteProposalFromTokensCss({
    tokens_css: (dsRes.data.tokens_css as string) ?? "",
    prefix: siteRow.prefix,
  });
  const diff = diffPalette({ current: paletteRes, proposal });
  const current_palette_sha = hashPalette(paletteRes);

  return {
    ok: true,
    ctx: {
      site_id,
      site_version_lock,
      site_wp_url: siteRow.wp_url,
      cfg,
      install: installRes,
      current_palette: paletteRes,
      current_palette_sha,
      proposal,
      diff,
    },
  };
}

function mapWpErrorToContext(err: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): PaletteSyncContextResult {
  if (err.code === "AUTH_FAILED") {
    return {
      ok: false,
      code: "WP_AUTH_FAILED",
      message: err.message,
      details: err.details,
    };
  }
  return {
    ok: false,
    code: "WP_REST_UNREACHABLE",
    message: err.message,
    details: err.details,
  };
}

// ---------------------------------------------------------------------------
// First-detection CAS stamp on sites.kadence_installed_at
// ---------------------------------------------------------------------------

export type StampResult =
  | { ok: true; stamped: boolean; new_version_lock: number }
  | { ok: false; code: "VERSION_CONFLICT" | "INTERNAL_ERROR"; message: string };

/**
 * If Kadence is active AND sites.kadence_installed_at is NULL, stamp
 * it under CAS on sites.version_lock. Idempotent: if it's already
 * stamped, return { stamped: false, new_version_lock: current }.
 *
 * The stamp records when Opollo FIRST CONFIRMED Kadence is live on
 * the site. Different from "when Opollo installed Kadence" — Opollo
 * doesn't install (per M13-5c rescope), only detects. The column
 * name stays kadence_installed_at because that's the operator-legible
 * meaning.
 */
export async function stampFirstDetection(opts: {
  site_id: string;
  expected_version_lock: number;
  created_by: string | null;
}): Promise<StampResult> {
  const svc = getServiceRoleClient();
  // Re-read to check if stamp already landed (avoids a noisy CAS churn
  // when the route runs on every panel render).
  const before = await svc
    .from("sites")
    .select("kadence_installed_at, version_lock")
    .eq("id", opts.site_id)
    .maybeSingle();
  if (before.error) {
    return { ok: false, code: "INTERNAL_ERROR", message: before.error.message };
  }
  if (!before.data) {
    return { ok: false, code: "INTERNAL_ERROR", message: "Site vanished." };
  }
  if (before.data.kadence_installed_at) {
    // Already stamped. Return the current version_lock so the caller
    // can proceed with subsequent writes that CAS against it.
    return {
      ok: true,
      stamped: false,
      new_version_lock: before.data.version_lock as number,
    };
  }

  const nowIso = new Date().toISOString();
  const upd = await svc
    .from("sites")
    .update({
      kadence_installed_at: nowIso,
      updated_at: nowIso,
      last_successful_operation_at: nowIso,
      version_lock: opts.expected_version_lock + 1,
    })
    .eq("id", opts.site_id)
    .eq("version_lock", opts.expected_version_lock)
    .select("version_lock")
    .maybeSingle();
  if (upd.error) {
    return { ok: false, code: "INTERNAL_ERROR", message: upd.error.message };
  }
  if (!upd.data) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message:
        "Another session changed this site while we were stamping Kadence detection. Refresh and retry.",
    };
  }
  return {
    ok: true,
    stamped: true,
    new_version_lock: upd.data.version_lock as number,
  };
}

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

export type PaletteDryRunResult = {
  ok: true;
  install: KadenceInstallState;
  current_palette: KadencePalette;
  current_palette_sha: string;
  proposal: KadencePaletteProposal;
  diff: PaletteDiff;
  /** True iff diff.any_changes is false — operator can skip the confirm. */
  already_synced: boolean;
};

/**
 * Dry-run returns everything the UI needs to render the diff table +
 * confirm modal. ZERO mutations: no WP writes, no Opollo writes, no
 * audit log.
 *
 * The sha returned here MUST be included in the subsequent
 * confirmedPaletteSync call. A mismatch between the sha the operator
 * saw and the sha of the current WP palette at confirm-time means
 * someone edited the Customizer between dry-run and confirm; we
 * refuse the write and surface WP_STATE_DRIFTED.
 */
export function paletteDryRunFromContext(
  ctx: PaletteSyncContext,
): PaletteDryRunResult {
  return {
    ok: true,
    install: ctx.install,
    current_palette: ctx.current_palette,
    current_palette_sha: ctx.current_palette_sha,
    proposal: ctx.proposal,
    diff: ctx.diff,
    already_synced: !ctx.diff.any_changes,
  };
}

// ---------------------------------------------------------------------------
// Confirmed sync
// ---------------------------------------------------------------------------

export type ConfirmedSyncResult =
  | {
      ok: true;
      code: "SYNCED" | "ALREADY_SYNCED";
      /** Stamped by Opollo immediately after WP confirms the write. */
      synced_at: string;
      new_site_version_lock: number;
      /** Audit-event id for rollback lookup later. */
      appearance_event_id: string | null;
      round_trip_ok: boolean;
    }
  | {
      ok: false;
      code:
        | "WP_STATE_DRIFTED"
        | "PROPOSAL_INSUFFICIENT"
        | "VERSION_CONFLICT"
        | "WP_WRITE_FAILED"
        | "INTERNAL_ERROR";
      message: string;
      /** When WP_STATE_DRIFTED: the new diff the operator should re-review. */
      details?: Record<string, unknown>;
    };

/**
 * The write path. Preconditions:
 *   - Context already built (Kadence active, DS present, creds OK).
 *   - Caller passes expected_current_palette_sha from the last
 *     dry-run response.
 *   - Caller passes expected_site_version_lock (sites.version_lock
 *     at the time the operator opened the confirm modal).
 *
 * Write order (deliberate):
 *   1. Drift check — compare expected sha against re-read current.
 *   2. Proposal must be source !== 'insufficient'.
 *   3. Empty diff → ALREADY_SYNCED (audit globals_dry_run + return).
 *   4. Audit globals_confirmed — marks operator intent pre-write.
 *   5. WP write via putKadencePalette.
 *   6. CAS UPDATE sites.kadence_globals_synced_at.
 *   7. Audit globals_completed with previous_palette snapshot.
 *   8. Return.
 *
 * On step-5 failure: audit globals_failed with WP error code. Opollo
 * state un-touched. On step-6 CAS miss: the WP write DID happen —
 * audit globals_completed anyway so rollback has a snapshot, then
 * surface VERSION_CONFLICT so the operator refreshes. Accepting this
 * "WP changed but Opollo timestamp stale" state is safer than
 * reverting the WP write on CAS miss (which would double-write WP).
 */
export async function confirmedPaletteSync(opts: {
  ctx: PaletteSyncContext;
  expected_current_palette_sha: string;
  confirmed_by: string | null;
}): Promise<ConfirmedSyncResult> {
  const { ctx, expected_current_palette_sha, confirmed_by } = opts;

  // Step 1 — drift check. Re-read current palette right before the
  // write to catch operator edits in WP Customizer between the
  // dry-run and the confirm.
  const freshRead = await getKadencePalette(ctx.cfg);
  if (!freshRead.ok) {
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "globals_failed",
      details: {
        stage: "fresh_read_before_write",
        wp_code: freshRead.code,
        wp_message: freshRead.message,
      },
      created_by: confirmed_by,
    });
    return {
      ok: false,
      code: "WP_WRITE_FAILED",
      message: `Failed to re-read current palette before write: ${freshRead.message}`,
    };
  }
  const freshSha = hashPalette(freshRead);
  if (freshSha !== expected_current_palette_sha) {
    const freshDiff = diffPalette({
      current: freshRead,
      proposal: ctx.proposal,
    });
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "globals_failed",
      details: {
        stage: "drift_check",
        expected_sha: expected_current_palette_sha,
        actual_sha: freshSha,
      },
      created_by: confirmed_by,
    });
    return {
      ok: false,
      code: "WP_STATE_DRIFTED",
      message:
        "The Kadence palette was edited in WP Admin between your preview and confirm. Refresh the Appearance panel and review the new diff before syncing.",
      details: {
        fresh_current_palette: freshRead,
        fresh_diff: freshDiff,
        fresh_sha: freshSha,
      },
    };
  }

  // Step 2 — proposal must be a real 8-slot palette.
  if (
    ctx.proposal.source === "insufficient" ||
    ctx.proposal.slots.length === 0
  ) {
    return {
      ok: false,
      code: "PROPOSAL_INSUFFICIENT",
      message:
        "Active design system doesn't declare enough color tokens for a Kadence palette (need 8+). Add more color tokens to tokens.css or explicit --<prefix>-palette-N slots.",
      details: {
        available_color_count: ctx.proposal.available_color_count,
      },
    };
  }

  // Step 3 — empty diff = idempotent.
  if (!ctx.diff.any_changes) {
    const dryRunLog = await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "globals_dry_run",
      details: {
        any_changes: false,
        proposal_source: ctx.proposal.source,
        note: "Confirmed sync hit an empty diff; treated as ALREADY_SYNCED.",
      },
      created_by: confirmed_by,
    });
    return {
      ok: true,
      code: "ALREADY_SYNCED",
      synced_at: new Date().toISOString(),
      new_site_version_lock: ctx.site_version_lock,
      appearance_event_id: dryRunLog.ok ? dryRunLog.id : null,
      round_trip_ok: true,
    };
  }

  // Step 4 — audit operator intent pre-write. If the process dies
  // between the WP write and the completed-event, this intent event
  // marks where the run started.
  await logAppearanceEvent({
    site_id: ctx.site_id,
    event: "globals_confirmed",
    details: {
      proposal_source: ctx.proposal.source,
      changed_slots: ctx.diff.entries
        .filter((e) => e.changed)
        .map((e) => e.slot),
    },
    created_by: confirmed_by,
  });

  // Step 5 — WP write.
  const writeRes = await putKadencePalette(ctx.cfg, ctx.proposal.slots);
  if (!writeRes.ok) {
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "globals_failed",
      details: {
        stage: "wp_write",
        wp_code: writeRes.code,
        wp_message: writeRes.message,
      },
      created_by: confirmed_by,
    });
    return {
      ok: false,
      code: "WP_WRITE_FAILED",
      message: writeRes.message,
      details: { wp_code: writeRes.code },
    };
  }

  // Step 6 — CAS stamp sites.kadence_globals_synced_at.
  const nowIso = new Date().toISOString();
  const svc = getServiceRoleClient();
  const casUpd = await svc
    .from("sites")
    .update({
      kadence_globals_synced_at: nowIso,
      updated_at: nowIso,
      last_successful_operation_at: nowIso,
      version_lock: ctx.site_version_lock + 1,
    })
    .eq("id", ctx.site_id)
    .eq("version_lock", ctx.site_version_lock)
    .select("version_lock")
    .maybeSingle();

  // Whether CAS succeeded or not, step 7 writes globals_completed —
  // the WP write happened, rollback needs the snapshot. CAS conflict
  // is surfaced separately.
  const completedLog = await logAppearanceEvent({
    site_id: ctx.site_id,
    event: "globals_completed",
    details: {
      previous_palette: ctx.current_palette,
      new_palette: writeRes.written,
      proposal_source: ctx.proposal.source,
      diff_hash_before: ctx.current_palette_sha,
      round_trip_ok: writeRes.round_trip_ok,
      ds_active_tokens_css_hash: null, // reserved for BACKLOG DS-version check
    },
    created_by: confirmed_by,
  });

  if (casUpd.error) {
    logger.error("kadence_palette_sync.cas_errored", {
      site_id: ctx.site_id,
      error: casUpd.error,
    });
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "Palette was written to WP but Opollo's sync timestamp update failed. Check audit log; site is in a recoverable state.",
    };
  }
  if (!casUpd.data) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message:
        "Palette was written to WP, but the site row changed while we were syncing. Refresh the Appearance panel — it will show the new synced_at from the audit log.",
    };
  }

  return {
    ok: true,
    code: "SYNCED",
    synced_at: nowIso,
    new_site_version_lock: casUpd.data.version_lock as number,
    appearance_event_id: completedLog.ok ? completedLog.id : null,
    round_trip_ok: writeRes.round_trip_ok,
  };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export type RollbackResult =
  | {
      ok: true;
      code: "ROLLED_BACK" | "ALREADY_ROLLED_BACK";
      rolled_back_at: string;
      reverted_from_event_id: string;
      new_site_version_lock: number;
    }
  | {
      ok: false;
      code:
        | "NO_PRIOR_SNAPSHOT"
        | "SNAPSHOT_MALFORMED"
        | "VERSION_CONFLICT"
        | "WP_WRITE_FAILED"
        | "INTERNAL_ERROR";
      message: string;
      details?: Record<string, unknown>;
    };

async function findLatestGlobalsCompletedEvent(
  site_id: string,
): Promise<AppearanceEventRow | null> {
  const events = await listAppearanceEventsForSite(site_id, 50);
  return events.find((e) => e.event === "globals_completed") ?? null;
}

function snapshotFromEvent(
  event: AppearanceEventRow,
): KadencePaletteEntry[] | null {
  const prev = (event.details as { previous_palette?: unknown })
    .previous_palette as { palette?: unknown } | undefined;
  const entries = (prev?.palette ?? []) as unknown[];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const out: KadencePaletteEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const slug = typeof e.slug === "string" ? e.slug : null;
    const color = typeof e.color === "string" ? e.color : null;
    const name = typeof e.name === "string" ? e.name : slug;
    if (!slug || !color || !name) continue;
    out.push({ slug, color, name });
  }
  return out.length > 0 ? out : null;
}

/**
 * Revert the last confirmed palette sync. Reads the latest
 * globals_completed event for the site, re-posts its previous_palette
 * snapshot to WP, writes a rollback_completed event with
 * reverted_from_event_id pointing at the event being undone.
 *
 * Idempotency: if the current WP palette already matches the
 * snapshot, no WP write happens and the route returns
 * ALREADY_ROLLED_BACK without logging a rollback_completed event —
 * keeps the audit chain clean.
 */
export async function rollbackPalette(opts: {
  ctx: PaletteSyncContext;
  expected_site_version_lock: number;
  requested_by: string | null;
}): Promise<RollbackResult> {
  const { ctx, expected_site_version_lock, requested_by } = opts;

  // Step 1 — find the snapshot.
  const completed = await findLatestGlobalsCompletedEvent(ctx.site_id);
  if (!completed) {
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "rollback_failed",
      details: { reason: "no_prior_globals_completed" },
      created_by: requested_by,
    });
    return {
      ok: false,
      code: "NO_PRIOR_SNAPSHOT",
      message:
        "No prior palette sync has been recorded for this site. There's nothing to roll back.",
    };
  }

  const snapshot = snapshotFromEvent(completed);
  if (!snapshot) {
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "rollback_failed",
      details: {
        reason: "snapshot_malformed",
        source_event_id: completed.id,
      },
      created_by: requested_by,
    });
    return {
      ok: false,
      code: "SNAPSHOT_MALFORMED",
      message:
        "The most recent sync's snapshot is missing or corrupt. Cannot rollback automatically.",
      details: { source_event_id: completed.id },
    };
  }

  // Step 2 — idempotency: if current WP palette matches the snapshot,
  // no write needed.
  const snapshotAsPalette: KadencePalette = {
    palette: snapshot,
    source: "populated",
  };
  const snapshotSha = hashPalette(snapshotAsPalette);
  if (snapshotSha === ctx.current_palette_sha) {
    // No WP write, no rollback_completed — just a requested event
    // so the audit log shows the operator clicked the button.
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "rollback_requested",
      details: {
        outcome: "already_rolled_back",
        source_event_id: completed.id,
      },
      created_by: requested_by,
    });
    return {
      ok: true,
      code: "ALREADY_ROLLED_BACK",
      rolled_back_at: new Date().toISOString(),
      reverted_from_event_id: completed.id,
      new_site_version_lock: ctx.site_version_lock,
    };
  }

  // Step 3 — audit rollback intent pre-write.
  await logAppearanceEvent({
    site_id: ctx.site_id,
    event: "rollback_requested",
    details: {
      outcome: "will_write",
      source_event_id: completed.id,
    },
    created_by: requested_by,
  });

  // Step 4 — WP write.
  const writeRes = await putKadencePalette(ctx.cfg, snapshot);
  if (!writeRes.ok) {
    await logAppearanceEvent({
      site_id: ctx.site_id,
      event: "rollback_failed",
      details: {
        stage: "wp_write",
        wp_code: writeRes.code,
        wp_message: writeRes.message,
        source_event_id: completed.id,
      },
      created_by: requested_by,
    });
    return {
      ok: false,
      code: "WP_WRITE_FAILED",
      message: writeRes.message,
      details: { wp_code: writeRes.code },
    };
  }

  // Step 5 — CAS stamp. Rollback is a sync op; it refreshes the
  // synced_at timestamp so the panel shows accurate recency.
  const nowIso = new Date().toISOString();
  const svc = getServiceRoleClient();
  const casUpd = await svc
    .from("sites")
    .update({
      kadence_globals_synced_at: nowIso,
      updated_at: nowIso,
      last_successful_operation_at: nowIso,
      version_lock: expected_site_version_lock + 1,
    })
    .eq("id", ctx.site_id)
    .eq("version_lock", expected_site_version_lock)
    .select("version_lock")
    .maybeSingle();

  const completedLog = await logAppearanceEvent({
    site_id: ctx.site_id,
    event: "rollback_completed",
    details: {
      reverted_from_event_id: completed.id,
      restored_palette: snapshotAsPalette,
      round_trip_ok: writeRes.round_trip_ok,
    },
    created_by: requested_by,
  });

  if (casUpd.error || !casUpd.data) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message:
        "Rollback was written to WP, but the site row changed while we were rolling back. Refresh the Appearance panel.",
      details: {
        completed_event_id: completedLog.ok ? completedLog.id : null,
      },
    };
  }

  return {
    ok: true,
    code: "ROLLED_BACK",
    rolled_back_at: nowIso,
    reverted_from_event_id: completed.id,
    new_site_version_lock: casUpd.data.version_lock as number,
  };
}
