import "server-only";

import { logger } from "@/lib/logger";
import {
  wpGetActiveTheme,
  wpGetSettings,
  wpListThemes,
  wpPutSettings,
  type WpConfig,
  type WpError,
  type WpResult,
  type WpTheme,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-5a — Kadence REST (read-only layer).
//
// Three reads that the Appearance panel + install preflight need:
//
//   1. getKadenceInstallState(cfg) — combines wpListThemes +
//      wpGetActiveTheme into a single "is Kadence installed, is it
//      active, what version" answer. The panel uses this to decide
//      whether to show "Install Kadence" or "Kadence active" + version.
//
//   2. getKadencePalette(cfg) — wraps wpGetSettings and parses the
//      Kadence Blocks `kadence_blocks_colors` option. Returns the
//      8-color palette array (or an empty array if the option is
//      unset, which is the post-install default).
//
//   3. parseKadencePaletteOption(raw) — pure helper that's exported
//      so the mapper (M13-5b) can reuse it without pinging WP. The
//      raw value is the JSON-encoded string Kadence stores in the
//      WP option.
//
// Write paths live in later sub-slices:
//   - Kadence install (theme install + activate): M13-5c
//   - Kadence palette sync: M13-5d
//
// Parent-plan rescope (2026-04-24): typography + spacing globals
// do NOT flow through here because they have no free-tier REST
// surface. See docs/BACKLOG.md "Kadence typography + spacing globals
// sync".
// ---------------------------------------------------------------------------

/**
 * The stylesheet slug of the theme Opollo installs + activates. Pinned
 * so preflight + install routes agree on the identity check.
 * Kadence ships on wordpress.org with stylesheet === "kadence".
 */
export const KADENCE_THEME_SLUG = "kadence";

/**
 * Kadence Blocks' free-tier palette slot count. Kadence Theme exposes
 * 9 --global-palette* CSS variables, but the Kadence Blocks editor
 * palette stores 8 entries by default (slot 9 is reserved for the
 * theme's "text on dark" background, which Kadence computes from the
 * other slots rather than letting the operator set directly).
 *
 * M13-5 writes 8 entries; the 9th stays as Kadence's computed default.
 */
export const KADENCE_PALETTE_SLOT_COUNT = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KadencePaletteEntry = {
  /** Kadence-assigned slug: "palette1" .. "palette8". */
  slug: string;
  /** Human-readable label shown in the WP Customizer. */
  name: string;
  /** Hex string, e.g. "#185FA5". */
  color: string;
};

export type KadencePalette = {
  /** The 8 color slots. Missing slots are allowed; the UI backfills. */
  palette: KadencePaletteEntry[];
  /**
   * Whether Kadence has never set this option (empty string in WP) vs
   * set-but-empty (JSON "[]"). The install flow cares about the
   * difference — an empty option means Kadence is installed but the
   * operator hasn't saved a palette yet.
   */
  source:
    | "unset" // option is "" (WP default for an unset setting)
    | "empty" // option is "[]" or similar valid-empty JSON
    | "populated"
    | "unparseable"; // JSON decode failed — surface to operator
};

export type KadenceInstallState = {
  /** True iff any installed theme has stylesheet === "kadence". */
  kadence_installed: boolean;
  /** True iff the active theme's stylesheet === "kadence". */
  kadence_active: boolean;
  /** Kadence's version string when installed; null otherwise. */
  kadence_version: string | null;
  /** The currently-active theme (regardless of whether it's Kadence). */
  active_theme: WpTheme | null;
  /**
   * The stylesheet slug of the currently-active theme. Captured
   * separately because the rollback-path audit trail records it as
   * "prior_active_theme_slug" and carrying it as a string field keeps
   * the event schema simple.
   */
  active_theme_slug: string | null;
};

export type GetKadenceInstallStateResult = WpResult<KadenceInstallState>;
export type GetKadencePaletteResult = WpResult<KadencePalette>;

// ---------------------------------------------------------------------------
// Pure helpers — exported so the mapper (M13-5b) + tests can use them
// without pinging WP.
// ---------------------------------------------------------------------------

/**
 * Parse Kadence's `kadence_blocks_colors` option value into a typed
 * KadencePalette. The option is stored as a JSON-encoded STRING per
 * the register_setting call in stellarwp/kadence-blocks:
 *   register_setting('kadence_blocks_colors', 'kadence_blocks_colors', {
 *     type: 'string',
 *     show_in_rest: true,
 *   });
 *
 * Valid shapes Kadence emits:
 *   ""                                → source = "unset"
 *   "[]"                              → source = "empty"
 *   '[{"slug":"palette1","color":"#123","name":"A"}, ...]'
 *                                     → source = "populated"
 *   any other non-JSON / non-array    → source = "unparseable"
 */
export function parseKadencePaletteOption(raw: unknown): KadencePalette {
  if (typeof raw !== "string") {
    // WP Core never emits a non-string for a string-typed setting, but
    // the REST shape is unknown at the TypeScript layer — defensive.
    return { palette: [], source: "unparseable" };
  }
  if (raw === "") return { palette: [], source: "unset" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { palette: [], source: "unparseable" };
  }
  if (!Array.isArray(parsed)) {
    return { palette: [], source: "unparseable" };
  }
  if (parsed.length === 0) {
    return { palette: [], source: "empty" };
  }
  const palette: KadencePaletteEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const slug = typeof e.slug === "string" ? e.slug : "";
    const color = typeof e.color === "string" ? e.color : "";
    const name = typeof e.name === "string" ? e.name : slug;
    if (!slug || !color) continue;
    palette.push({ slug, color, name });
  }
  if (palette.length === 0) {
    // All entries were schema-invalid — record as unparseable so the
    // operator sees the right blocker copy.
    return { palette: [], source: "unparseable" };
  }
  return { palette, source: "populated" };
}

// ---------------------------------------------------------------------------
// REST reads
// ---------------------------------------------------------------------------

/**
 * Fetch the Kadence install state by composing wpListThemes +
 * wpGetActiveTheme. Returns the WP-side answer without touching
 * Opollo's own sites.kadence_installed_at timestamp — the Appearance
 * panel reconciles the two if they drift.
 */
export async function getKadenceInstallState(
  cfg: WpConfig,
): Promise<GetKadenceInstallStateResult> {
  const [listRes, activeRes] = await Promise.all([
    wpListThemes(cfg),
    wpGetActiveTheme(cfg),
  ]);

  if (!listRes.ok) return listRes;
  if (!activeRes.ok) return activeRes;

  const kadenceEntry = listRes.themes.find(
    (t) => t.stylesheet === KADENCE_THEME_SLUG,
  );
  const activeSlug = activeRes.theme?.stylesheet ?? null;
  const installed = Boolean(kadenceEntry);
  const active = activeSlug === KADENCE_THEME_SLUG;

  return {
    ok: true,
    kadence_installed: installed,
    kadence_active: active,
    kadence_version: kadenceEntry?.version ?? null,
    active_theme: activeRes.theme,
    active_theme_slug: activeSlug,
  };
}

/**
 * Fetch the Kadence palette from `/wp/v2/settings` and parse the
 * JSON-encoded string into a typed KadencePalette. Logs a warning if
 * the option exists but fails to parse (a Kadence version drift or
 * operator hand-edit of wp_options would surface here).
 */
export async function getKadencePalette(
  cfg: WpConfig,
): Promise<GetKadencePaletteResult> {
  const res = await wpGetSettings(cfg);
  if (!res.ok) return res;
  const raw = res.settings["kadence_blocks_colors"];
  const parsed = parseKadencePaletteOption(raw);
  if (parsed.source === "unparseable") {
    logger.warn("kadence_rest.palette_unparseable", {
      raw_type: typeof raw,
      // Length guard: don't log the whole payload; just confirm there's
      // something to debug.
      raw_length:
        typeof raw === "string" ? raw.length : Array.isArray(raw) ? raw.length : 0,
    });
  }
  return { ok: true, ...parsed };
}

// ---------------------------------------------------------------------------
// M13-5c — palette write.
//
// `putKadencePalette` is the only write primitive in this file; every
// mutation of Kadence-owned state flows through here so tests + audit
// have a single function to intercept.
// ---------------------------------------------------------------------------

/**
 * Serialize a KadencePaletteEntry array into Kadence's on-wire shape.
 * Kadence stores the palette as a JSON-encoded STRING under the
 * `kadence_blocks_colors` option (see register_setting call in
 * stellarwp/kadence-blocks). Fields Kadence recognises on each entry:
 *   - slug  (palette1..palette8)
 *   - name  (human-readable label shown in the Customizer)
 *   - color (hex string)
 */
export function serializeKadencePalette(
  palette: KadencePaletteEntry[],
): string {
  return JSON.stringify(
    palette.map((p) => ({ slug: p.slug, name: p.name, color: p.color })),
  );
}

export type PutKadencePaletteResult =
  | {
      ok: true;
      /** The palette Kadence echoed back after sanitisation. */
      written: KadencePalette;
      /**
       * Whether the echoed value exactly matches what we sent.
       * `false` means WP's sanitize_text_field stripped characters or
       * Kadence rejected one of the slots. Caller surfaces this as a
       * warning; the write still happened.
       */
      round_trip_ok: boolean;
    }
  | WpError;

/**
 * Write a palette to WP via `/wp/v2/settings`. Caller MUST have
 * already:
 *   - run preflight (cap check passed)
 *   - confirmed Kadence is active (otherwise writing
 *     kadence_blocks_colors is harmless but pointless; the panel
 *     wouldn't use the palette anyway)
 *   - snapshotted the prior palette into appearance_events for
 *     rollback recovery
 *
 * On success, returns what WP echoed back + a round_trip_ok flag the
 * caller uses to detect sanitisation drift.
 */
export async function putKadencePalette(
  cfg: WpConfig,
  palette: KadencePaletteEntry[],
): Promise<PutKadencePaletteResult> {
  const payload = serializeKadencePalette(palette);
  const res = await wpPutSettings(cfg, { kadence_blocks_colors: payload });
  if (!res.ok) return res;

  const echoedRaw = res.settings["kadence_blocks_colors"];
  const written = parseKadencePaletteOption(echoedRaw);
  // Round-trip check: WP's sanitize_text_field strips tags / certain
  // control chars. Our palette JSON has neither, so the echo should
  // match. If it doesn't, something changed server-side we need to
  // know about.
  const echoedSerialized = serializeKadencePalette(written.palette);
  const round_trip_ok = echoedSerialized === payload;
  if (!round_trip_ok) {
    logger.warn("kadence_rest.palette_write_round_trip_mismatch", {
      sent_length: payload.length,
      echoed_length: echoedSerialized.length,
      echoed_source: written.source,
    });
  }
  return { ok: true, written, round_trip_ok };
}

/**
 * Convenience re-export so downstream callers only import from this
 * file when they care about Kadence state.
 */
export type { WpConfig, WpError, WpTheme };
