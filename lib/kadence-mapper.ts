import "server-only";

import {
  KADENCE_PALETTE_SLOT_COUNT,
  type KadencePalette,
  type KadencePaletteEntry,
} from "@/lib/kadence-rest";

// ---------------------------------------------------------------------------
// M13-5b — DS → Kadence palette mapper.
//
// Pure logic. No I/O. Two responsibilities:
//
//   1. parsePaletteTokens: read a DS `tokens_css` string, find every
//      CSS custom property whose value is a color literal, return
//      them as typed DsTokenEntry records in declaration order.
//
//   2. buildPaletteProposal: given parsed tokens + the site's DS
//      prefix, produce a 8-slot KadencePaletteProposal:
//        - source 'explicit' when all 8 --<prefix>-palette-N tokens
//          are present (operator opted into explicit slot mapping)
//        - source 'ordered_hex' when we fell back to declaration-order
//          (the first 8 hex-valued tokens fill slots palette1..palette8)
//        - source 'insufficient' when fewer than 8 color tokens exist
//          in the DS — caller (UI) surfaces a clear blocker instead of
//          silently shipping a truncated palette
//
//   3. diffPalette: compare a Kadence-current palette (from
//      lib/kadence-rest::getKadencePalette) against a proposal and
//      report per-slot changes. Drives the Appearance panel's dry-run
//      preview table (M13-5e).
//
// Rescope note (2026-04-24): palette-only. Typography + spacing
// globals are BACKLOG per docs/BACKLOG.md §"Kadence typography +
// spacing globals sync". The parsePaletteTokens regex intentionally
// skips non-color values — extending to typography/spacing would
// happen here as additional parsers when the BACKLOG slice ships.
// ---------------------------------------------------------------------------

/**
 * Kadence's palette slots are named palette1..palette8. M13-5a pinned
 * KADENCE_PALETTE_SLOT_COUNT = 8 (the 9th is computed by Kadence from
 * the other slots).
 */
export const KADENCE_PALETTE_SLOT_NAMES = Array.from(
  { length: KADENCE_PALETTE_SLOT_COUNT },
  (_, i) => `palette${i + 1}`,
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DsTokenEntry = {
  /** Full property name including leading dashes, e.g. "--ls-blue". */
  name: string;
  /** Operator-legible label derived from the property: "Blue" for --ls-blue. */
  label: string;
  /** Normalized uppercase #RRGGBB hex (or #RRGGBBAA if alpha present). */
  color: string;
};

export type KadencePaletteProposal = {
  /**
   * Exactly 8 slots when source !== 'insufficient'; empty array when
   * 'insufficient'. Callers that care about the `slots` contract MUST
   * check `source` first.
   */
  slots: KadencePaletteEntry[];
  source: "explicit" | "ordered_hex" | "insufficient";
  /** Number of color-valued DS tokens parsed. Useful for the 'insufficient' UI copy. */
  available_color_count: number;
};

export type PaletteDiffEntry = {
  slot: string;
  current: { name: string | null; color: string | null };
  proposed: { name: string; color: string };
  /** True iff the proposed color would change the slot's current value. */
  changed: boolean;
};

export type PaletteDiff = {
  entries: PaletteDiffEntry[];
  /** True iff any entry has changed=true. */
  any_changes: boolean;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// One CSS custom-property declaration on one line. We only match a
// minimal subset — no multi-line values, no !important. The DS tokens
// seed files all emit single-line declarations so we optimize for that
// shape; a pathological input degrades gracefully (just parses fewer
// tokens).
const DECLARATION_RE =
  /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+?)\s*(?:!important)?\s*;\s*$/i;

// Hex color: #RGB, #RGBA, #RRGGBB, #RRGGBBAA.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Parenthesized color function: rgb / rgba / hsl / hsla. We don't
// compute the resulting hex for non-hex inputs — supporting hsl() or
// rgb() would require color-space math. For MVP we emit them verbatim
// as "non-hex" and the caller can reject. The two DS fixtures in-tree
// both use #hex throughout; color-function support is a BACKLOG
// candidate if a DS lands with rgb()/hsl().
const COLOR_FN_RE = /^(rgb|rgba|hsl|hsla)\s*\(/i;

function isColorValue(value: string): boolean {
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) || COLOR_FN_RE.test(trimmed);
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const m = HEX_RE.exec(trimmed);
  if (!m) return null;
  const raw = m[1]!;
  // Expand #RGB / #RGBA shorthands to #RRGGBB / #RRGGBBAA.
  if (raw.length === 3 || raw.length === 4) {
    const expanded = raw
      .split("")
      .map((ch) => ch + ch)
      .join("");
    return "#" + expanded.toUpperCase();
  }
  return "#" + raw.toUpperCase();
}

function labelFromPropertyName(name: string, prefix: string): string {
  // --ls-blue-dark   →   "Blue dark"  (strip "--<prefix>-")
  // --my-primary     →   "My primary" (prefix doesn't match; keep full
  //                       name sans leading dashes)
  const strippedDashes = name.replace(/^--/, "");
  const withoutPrefix =
    prefix && strippedDashes.startsWith(`${prefix}-`)
      ? strippedDashes.slice(prefix.length + 1)
      : strippedDashes;
  const words = withoutPrefix.replace(/-/g, " ").trim();
  if (!words) return strippedDashes;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Walk the tokens_css string line by line, extract every custom
 * property whose value parses as a color. Preserves declaration order
 * (important because buildPaletteProposal's fallback uses order to
 * pick the first 8 colors).
 *
 * Skips color-function values (rgb/hsl) — they land in the output with
 * `color: ""` and will be filtered by buildPaletteProposal. Caller
 * wanting full color-space support plugs into the COLOR_FN_RE branch
 * of isColorValue + adds a normalizer.
 */
export function parsePaletteTokens(
  tokensCss: string,
  prefix: string,
): DsTokenEntry[] {
  const out: DsTokenEntry[] = [];
  for (const rawLine of tokensCss.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\*.*?\*\//g, "").trim();
    if (!line || line.startsWith("//")) continue;
    const m = DECLARATION_RE.exec(line);
    if (!m) continue;
    const [, propName, propValue] = m;
    if (!propName || !propValue) continue;
    if (!isColorValue(propValue)) continue;
    const normalized = normalizeHex(propValue);
    if (!normalized) continue; // color-function — skip in this slice.
    out.push({
      name: propName,
      label: labelFromPropertyName(propName, prefix),
      color: normalized,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Proposal builder
// ---------------------------------------------------------------------------

/**
 * Does the token set contain all 8 `--<prefix>-palette-N` slots?
 * When true, they're the authoritative mapping (operator opted in).
 */
function findExplicitSlots(
  tokens: DsTokenEntry[],
  prefix: string,
): DsTokenEntry[] | null {
  const byName = new Map(tokens.map((t) => [t.name, t]));
  const slots: DsTokenEntry[] = [];
  for (let i = 1; i <= KADENCE_PALETTE_SLOT_COUNT; i++) {
    const slotName = `--${prefix}-palette-${i}`;
    const match = byName.get(slotName);
    if (!match) return null; // missing a slot — explicit mode off.
    slots.push(match);
  }
  return slots;
}

/**
 * Build a Kadence palette proposal from parsed DS tokens. The site's
 * DS prefix is required for explicit-slot detection + label derivation.
 *
 * Preference order:
 *   1. If all 8 `--<prefix>-palette-N` tokens exist → source='explicit'.
 *   2. Else if >= 8 hex-valued tokens exist → source='ordered_hex'
 *      (first 8 in declaration order).
 *   3. Else → source='insufficient', slots=[] (caller must surface a
 *      blocker — DS doesn't have enough colors for Kadence sync).
 */
export function buildPaletteProposal(opts: {
  tokens: DsTokenEntry[];
  prefix: string;
}): KadencePaletteProposal {
  const { tokens, prefix } = opts;
  const colorCount = tokens.length;

  const explicit = findExplicitSlots(tokens, prefix);
  if (explicit) {
    return {
      slots: explicit.map((t, i) => ({
        slug: KADENCE_PALETTE_SLOT_NAMES[i]!,
        name: t.label,
        color: t.color,
      })),
      source: "explicit",
      available_color_count: colorCount,
    };
  }

  if (colorCount < KADENCE_PALETTE_SLOT_COUNT) {
    return {
      slots: [],
      source: "insufficient",
      available_color_count: colorCount,
    };
  }

  const first8 = tokens.slice(0, KADENCE_PALETTE_SLOT_COUNT);
  return {
    slots: first8.map((t, i) => ({
      slug: KADENCE_PALETTE_SLOT_NAMES[i]!,
      name: t.label,
      color: t.color,
    })),
    source: "ordered_hex",
    available_color_count: colorCount,
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function findCurrent(
  current: KadencePalette,
  slug: string,
): KadencePaletteEntry | undefined {
  return current.palette.find((p) => p.slug === slug);
}

/**
 * Compare a Kadence-current palette against a proposal. Returns an
 * 8-entry diff (one per slot) regardless of how many slots the current
 * palette has populated. Missing slots in the current palette render
 * as { current: { name: null, color: null } }; any proposal value
 * then counts as a change.
 *
 * When proposal.source === 'insufficient', diff entries are empty and
 * any_changes is false — the UI surfaces the blocker copy instead of
 * a diff table.
 */
export function diffPalette(opts: {
  current: KadencePalette;
  proposal: KadencePaletteProposal;
}): PaletteDiff {
  const { current, proposal } = opts;
  if (proposal.source === "insufficient" || proposal.slots.length === 0) {
    return { entries: [], any_changes: false };
  }

  const entries: PaletteDiffEntry[] = proposal.slots.map((slotEntry) => {
    const currentEntry = findCurrent(current, slotEntry.slug);
    const currentColor = currentEntry?.color ?? null;
    const currentName = currentEntry?.name ?? null;
    // Case-insensitive hex comparison — Kadence may return lowercase.
    const changed =
      currentColor === null ||
      currentColor.toUpperCase() !== slotEntry.color.toUpperCase();
    return {
      slot: slotEntry.slug,
      current: { name: currentName, color: currentColor },
      proposed: { name: slotEntry.name, color: slotEntry.color },
      changed,
    };
  });
  return {
    entries,
    any_changes: entries.some((e) => e.changed),
  };
}

/**
 * Convenience composition: parse → propose. Callers that want the
 * full pipeline (tokens_css → proposal) typically hit this; the
 * individual functions are exported for testability + future reuse
 * by the BACKLOG typography/spacing slice.
 */
export function buildPaletteProposalFromTokensCss(opts: {
  tokens_css: string;
  prefix: string;
}): KadencePaletteProposal {
  const tokens = parsePaletteTokens(opts.tokens_css, opts.prefix);
  return buildPaletteProposal({ tokens, prefix: opts.prefix });
}
