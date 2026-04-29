// ---------------------------------------------------------------------------
// BL-5 — Bulk-paste splitter.
//
// Pure-logic helper that splits a multi-document paste into individual
// post candidates. Two recognised shapes:
//
//   1. Document-separator mode: documents separated by a `---`
//      delimiter line surrounded by blank lines (`\n\n---\n\n`). Each
//      segment can carry its own YAML front-matter on top.
//   2. Stacked YAML-front-matter mode: each document opens with a
//      `---` YAML block, prose follows, next document's `---` opens
//      directly. The splitter walks YAML opens and captures each
//      block + the body text between it and the next YAML open.
//
// We auto-detect mode-2 when the first non-blank line is `---` AND
// there's at least one further pair of `---` later. Otherwise we fall
// back to mode-1 (separator-based).
// ---------------------------------------------------------------------------

export interface SplitDocument {
  /** Raw text the parser will consume. Includes any front-matter. */
  source: string;
  /** Index in the original paste, 0-based. */
  index: number;
}

export function splitBulkPaste(text: string): SplitDocument[] {
  const trimmed = text.replace(/^\s+/, "");
  if (trimmed.length === 0) return [];

  // Mode-2 detection: first non-blank line is `---`, and at least
  // two additional standalone `---` lines exist later (one to close
  // the first block, one to open the second).
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim();
  if (firstLine === "---") {
    const stacked = splitStackedYaml(trimmed);
    if (stacked.length >= 2) return stacked;
  }

  // Mode-1: split on a standalone `---` between blank lines. We use
  // a regex that requires explicit blank lines on both sides so a
  // single document with internal `---` (e.g. an HR rule) isn't
  // mistakenly bisected.
  const segments = trimmed
    .split(/\r?\n\s*\r?\n---\s*\r?\n\s*\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return segments.map((source, index) => ({ source, index }));
}

function splitStackedYaml(text: string): SplitDocument[] {
  const lines = text.split(/\r?\n/);
  const yamlOpenIndices: number[] = [];
  let inYaml = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== "---") continue;
    if (!inYaml) {
      yamlOpenIndices.push(i);
      inYaml = true;
    } else {
      inYaml = false;
    }
  }
  if (yamlOpenIndices.length < 2) return [];

  const docs: SplitDocument[] = [];
  for (let i = 0; i < yamlOpenIndices.length; i++) {
    const start = yamlOpenIndices[i] ?? 0;
    const end = yamlOpenIndices[i + 1] ?? lines.length;
    const slice = lines.slice(start, end).join("\n").trim();
    if (slice.length > 0) {
      docs.push({ source: slice, index: i });
    }
  }
  return docs;
}
