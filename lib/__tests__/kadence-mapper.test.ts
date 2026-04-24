import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  KADENCE_PALETTE_SLOT_NAMES,
  buildPaletteProposal,
  buildPaletteProposalFromTokensCss,
  diffPalette,
  parsePaletteTokens,
} from "@/lib/kadence-mapper";
import type { KadencePalette } from "@/lib/kadence-rest";

// ---------------------------------------------------------------------------
// M13-5b kadence-mapper unit tests.
//
// Three fixtures drive the test matrix:
//   - tokens-leadsource.css:       15+ tokens, no explicit slot names
//                                  → 'ordered_hex'
//   - tokens-explicit-palette.css: 8 explicit --acme-palette-N + extras
//                                  → 'explicit' (ignores the extras)
//   - tokens-sparse.css:           only 4 color tokens
//                                  → 'insufficient', slots=[]
//
// Parser + proposal + diff are all pure, so no DB + no network.
// ---------------------------------------------------------------------------

const FIX_DIR = join(__dirname, "_fixtures");

let LEADSOURCE_CSS: string;
let EXPLICIT_CSS: string;
let SPARSE_CSS: string;

beforeAll(async () => {
  LEADSOURCE_CSS = await readFile(
    join(FIX_DIR, "tokens-leadsource.css"),
    "utf8",
  );
  EXPLICIT_CSS = await readFile(
    join(FIX_DIR, "tokens-explicit-palette.css"),
    "utf8",
  );
  SPARSE_CSS = await readFile(join(FIX_DIR, "tokens-sparse.css"), "utf8");
});

// ---------------------------------------------------------------------------
// parsePaletteTokens
// ---------------------------------------------------------------------------

describe("parsePaletteTokens", () => {
  it("extracts every hex-valued custom property in declaration order", () => {
    const tokens = parsePaletteTokens(LEADSOURCE_CSS, "ls");
    // Leadsource fixture has 14 hex-valued tokens (5 brand + 9 neutrals)
    // and skips gradient + font + spacing.
    expect(tokens).toHaveLength(14);
    // Declaration order is preserved.
    expect(tokens[0]).toEqual({
      name: "--ls-blue",
      label: "Blue",
      color: "#185FA5",
    });
    expect(tokens[1]?.name).toBe("--ls-blue-dark");
    expect(tokens[4]?.name).toBe("--ls-amber");
    expect(tokens[5]?.name).toBe("--ls-ink");
    expect(tokens[13]?.name).toBe("--ls-white");
  });

  it("derives a human-readable label from property names sans prefix", () => {
    const tokens = parsePaletteTokens(LEADSOURCE_CSS, "ls");
    const byName = new Map(tokens.map((t) => [t.name, t.label]));
    expect(byName.get("--ls-blue")).toBe("Blue");
    expect(byName.get("--ls-blue-dark")).toBe("Blue dark");
    expect(byName.get("--ls-border-strong")).toBe("Border strong");
  });

  it("expands #RGB shorthand to #RRGGBB and uppercases the result", () => {
    const tokens = parsePaletteTokens(
      `
      .scope {
        --x-a: #abc;
        --x-b: #aabbcc;
        --x-c: #AABBCC;
      }
      `,
      "x",
    );
    expect(tokens.map((t) => t.color)).toEqual([
      "#AABBCC",
      "#AABBCC",
      "#AABBCC",
    ]);
  });

  it("preserves alpha in #RGBA and #RRGGBBAA", () => {
    const tokens = parsePaletteTokens(
      `.scope { --x-a: #abcd; --x-b: #aabbccdd; }`,
      "x",
    );
    expect(tokens[0]?.color).toBe("#AABBCCDD");
    expect(tokens[1]?.color).toBe("#AABBCCDD");
  });

  it("skips non-color values (fonts, spacing, gradients)", () => {
    const tokens = parsePaletteTokens(LEADSOURCE_CSS, "ls");
    const names = new Set(tokens.map((t) => t.name));
    expect(names.has("--ls-arc")).toBe(false); // gradient
    expect(names.has("--ls-font-sans")).toBe(false); // font
    expect(names.has("--ls-space-xs")).toBe(false); // spacing
  });

  it("skips rgb() and hsl() functions (they'd need color-space math)", () => {
    const tokens = parsePaletteTokens(
      `.scope {
        --x-a: rgb(255, 0, 0);
        --x-b: hsl(120, 100%, 50%);
        --x-c: #FF0000;
      }`,
      "x",
    );
    // rgb/hsl are recognized as colors but not normalized → dropped.
    // Only the hex survives.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.name).toBe("--x-c");
  });

  it("ignores lines inside /* … */ comments", () => {
    const tokens = parsePaletteTokens(
      `.scope {
        /* --commented-out: #000000; */
        --kept: #FFFFFF;
      }`,
      "",
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.name).toBe("--kept");
  });

  it("handles property names without matching the prefix — label falls back to full name", () => {
    const tokens = parsePaletteTokens(`.scope { --random-thing: #111222; }`, "ls");
    expect(tokens[0]?.label).toBe("Random thing");
  });

  it("returns empty array on empty / whitespace-only input", () => {
    expect(parsePaletteTokens("", "ls")).toEqual([]);
    expect(parsePaletteTokens("\n\n  \n", "ls")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildPaletteProposal
// ---------------------------------------------------------------------------

describe("buildPaletteProposal", () => {
  it("source='ordered_hex' on leadsource fixture: first 8 tokens fill palette1..palette8", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    expect(proposal.source).toBe("ordered_hex");
    expect(proposal.available_color_count).toBe(14);
    expect(proposal.slots).toHaveLength(8);

    // Pin the exact mapping — the first 8 leadsource colors in
    // declaration order.
    expect(proposal.slots[0]).toEqual({
      slug: "palette1",
      name: "Blue",
      color: "#185FA5",
    });
    expect(proposal.slots[1]).toEqual({
      slug: "palette2",
      name: "Blue dark",
      color: "#0C447C",
    });
    expect(proposal.slots[4]).toEqual({
      slug: "palette5",
      name: "Amber",
      color: "#BA7517",
    });
    expect(proposal.slots[7]).toEqual({
      slug: "palette8",
      name: "Muted",
      color: "#6B6B66",
    });
  });

  it("source='explicit' when all 8 --<prefix>-palette-N tokens are present", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: EXPLICIT_CSS,
      prefix: "acme",
    });
    expect(proposal.source).toBe("explicit");
    expect(proposal.slots).toHaveLength(8);

    // Explicit slots win — the --acme-brand-* extras in the file are
    // ignored even though they're valid hex tokens.
    expect(proposal.slots[0]).toEqual({
      slug: "palette1",
      name: "Palette 1",
      color: "#FF0055",
    });
    expect(proposal.slots[7]).toEqual({
      slug: "palette8",
      name: "Palette 8",
      color: "#111111",
    });
  });

  it("source='insufficient' when fewer than 8 color tokens exist", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: SPARSE_CSS,
      prefix: "xyz",
    });
    expect(proposal.source).toBe("insufficient");
    expect(proposal.available_color_count).toBe(4);
    expect(proposal.slots).toEqual([]);
  });

  it("falls back to 'ordered_hex' when explicit slots are partial (< 8)", () => {
    // 7 out of 8 slots declared explicitly → not 'explicit'.
    const css = `
      .acme-scope {
        --acme-palette-1: #111111;
        --acme-palette-2: #222222;
        --acme-palette-3: #333333;
        --acme-palette-4: #444444;
        --acme-palette-5: #555555;
        --acme-palette-6: #666666;
        --acme-palette-7: #777777;
        /* palette-8 intentionally missing */
        --acme-extra:     #EEEEEE;
      }
    `;
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: css,
      prefix: "acme",
    });
    expect(proposal.source).toBe("ordered_hex");
    // Declaration-order fallback: 8 tokens available, takes them in order.
    expect(proposal.slots).toHaveLength(8);
    expect(proposal.slots[0]?.color).toBe("#111111"); // --acme-palette-1
    expect(proposal.slots[7]?.color).toBe("#EEEEEE"); // --acme-extra
  });

  it("slot names are palette1..palette8 in order", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: EXPLICIT_CSS,
      prefix: "acme",
    });
    expect(proposal.slots.map((s) => s.slug)).toEqual(KADENCE_PALETTE_SLOT_NAMES);
  });
});

// ---------------------------------------------------------------------------
// diffPalette
// ---------------------------------------------------------------------------

describe("diffPalette", () => {
  it("flags every slot as changed when current palette is empty", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    const current: KadencePalette = { palette: [], source: "empty" };
    const diff = diffPalette({ current, proposal });
    expect(diff.entries).toHaveLength(8);
    expect(diff.any_changes).toBe(true);
    expect(diff.entries.every((e) => e.changed)).toBe(true);
    expect(diff.entries[0]?.current).toEqual({ name: null, color: null });
    expect(diff.entries[0]?.proposed).toEqual({
      name: "Blue",
      color: "#185FA5",
    });
  });

  it("flags no changes when current palette matches the proposal exactly", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    const current: KadencePalette = {
      palette: proposal.slots.map((s) => ({
        slug: s.slug,
        name: s.name,
        color: s.color,
      })),
      source: "populated",
    };
    const diff = diffPalette({ current, proposal });
    expect(diff.any_changes).toBe(false);
    expect(diff.entries.every((e) => !e.changed)).toBe(true);
  });

  it("ignores case differences when comparing hex values (Kadence may return lowercase)", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: `
        .ls-scope {
          --ls-a: #AABBCC;
          --ls-b: #DDEEFF;
          --ls-c: #112233;
          --ls-d: #445566;
          --ls-e: #778899;
          --ls-f: #112244;
          --ls-g: #556677;
          --ls-h: #887766;
        }
      `,
      prefix: "ls",
    });
    const current: KadencePalette = {
      palette: proposal.slots.map((s) => ({
        slug: s.slug,
        name: s.name,
        color: s.color.toLowerCase(),
      })),
      source: "populated",
    };
    const diff = diffPalette({ current, proposal });
    expect(diff.any_changes).toBe(false);
  });

  it("flags only the changed slots when the current palette is partially divergent", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    // Current palette matches slots 1-6; 7 + 8 are different.
    const current: KadencePalette = {
      palette: proposal.slots.map((s, i) => ({
        slug: s.slug,
        name: s.name,
        color: i < 6 ? s.color : "#000000",
      })),
      source: "populated",
    };
    const diff = diffPalette({ current, proposal });
    expect(diff.any_changes).toBe(true);
    expect(diff.entries.filter((e) => e.changed)).toHaveLength(2);
    const changedSlots = diff.entries.filter((e) => e.changed).map((e) => e.slot);
    expect(changedSlots).toEqual(["palette7", "palette8"]);
  });

  it("returns empty diff + any_changes=false when proposal is 'insufficient'", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: SPARSE_CSS,
      prefix: "xyz",
    });
    const current: KadencePalette = {
      palette: [
        { slug: "palette1", name: "Old", color: "#ABCDEF" },
      ],
      source: "populated",
    };
    const diff = diffPalette({ current, proposal });
    expect(diff.entries).toEqual([]);
    expect(diff.any_changes).toBe(false);
  });

  it("treats a missing slot on current as a change (current.color=null)", () => {
    const proposal = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    // Current palette has only slots 1 + 2 populated.
    const current: KadencePalette = {
      palette: [
        { slug: "palette1", name: "Blue", color: "#185FA5" },
        { slug: "palette2", name: "Blue dark", color: "#0C447C" },
      ],
      source: "populated",
    };
    const diff = diffPalette({ current, proposal });
    expect(diff.entries[0]?.changed).toBe(false); // matches
    expect(diff.entries[1]?.changed).toBe(false); // matches
    // Slots 3-8 missing on current → all changed.
    expect(diff.entries.slice(2).every((e) => e.changed)).toBe(true);
    expect(diff.entries[2]?.current.color).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPaletteProposal (direct, from parsed tokens)
// ---------------------------------------------------------------------------

describe("buildPaletteProposal (from tokens array)", () => {
  it("composes parse + propose: equivalent to buildPaletteProposalFromTokensCss", () => {
    const viaFull = buildPaletteProposalFromTokensCss({
      tokens_css: LEADSOURCE_CSS,
      prefix: "ls",
    });
    const tokens = parsePaletteTokens(LEADSOURCE_CSS, "ls");
    const viaTokens = buildPaletteProposal({ tokens, prefix: "ls" });
    expect(viaFull).toEqual(viaTokens);
  });
});
