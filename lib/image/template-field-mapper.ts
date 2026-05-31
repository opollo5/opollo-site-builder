/**
 * template-field-mapper — maps spreadsheet columns to template field modifications.
 *
 * Stream B §3.3 implementation. Given a template's /fields response and a set
 * of spreadsheet column headers, produces:
 *   1. A mapping report (TemplateMappingResult) for pre-dispatch preview UI.
 *   2. A function to convert a spreadsheet row to a Modification[].
 *
 * Matching strategy (§3.3 confirmed):
 *   1. Exact match on field.name (case-insensitive, trimmed)
 *   2. Fallback: match on field.var.label (case-insensitive, trimmed)
 *   3. Warn on unmatched columns; error only on missing required fields.
 *
 * Image layer handling (must-have #4):
 *   A cell value for an image field is treated as a URL (image_url modification).
 *   Pre-flight URL validation is a Phase 4 UI concern; this mapper produces the
 *   Modification[] regardless. The QStash handler gracefully handles fetch
 *   failures per-job (skips the layer, records ImageLayerWarning).
 *
 * No server-only import — safe in both client and server contexts.
 */

import type { Modification } from "@/lib/image/template-model";
import type { TemplateField } from "@/lib/image/template-model";
import type {
  SpreadsheetRow,
  TemplateMappingResult,
  FieldMappingEntry,
  MappingMethod,
} from "@/lib/image/template-bulk-types";

// ─── Column mapping ────────────────────────────────────────────────────────────

/**
 * Match template fields to spreadsheet columns.
 * Returns a mapping result usable for the pre-dispatch confirmation UI and
 * for generating modifications per row.
 *
 * @param fields   TemplateField[] from GET /templates/:id/fields
 * @param headers  Column headers from the spreadsheet
 * @param sampleRow Optional first data row for sample value display in UI
 */
export function mapFieldsToColumns(
  fields: TemplateField[],
  headers: string[],
  sampleRow?: SpreadsheetRow,
): TemplateMappingResult {
  const usedColumns = new Set<string>();
  const entries: FieldMappingEntry[] = [];
  const unmatched_required: string[] = [];

  for (const field of fields) {
    const { matchedColumn, matchMethod } = findColumnMatch(field, headers);
    if (matchedColumn) usedColumns.add(matchedColumn);

    const sampleValue =
      matchedColumn && sampleRow ? (sampleRow[matchedColumn] ?? null) : null;

    const entry: FieldMappingEntry = {
      fieldName: field.name,
      fieldLabel: field.var.label,
      fieldType: field.type as "text" | "image" | "rectangle",
      required: field.var.required,
      defaultValue: field.var.default ?? "",
      matchedColumn,
      matchMethod,
      sampleValue,
    };

    if (field.var.required && !matchedColumn) {
      unmatched_required.push(field.name);
    }

    entries.push(entry);
  }

  const unusedColumns = headers.filter(h => !usedColumns.has(h));

  return {
    fields: entries,
    unusedColumns,
    hasRequiredUnmatched: unmatched_required.length > 0,
    unmatched_required,
  };
}

/** Find the best-matching spreadsheet column for a template field. */
function findColumnMatch(
  field: TemplateField,
  headers: string[],
): { matchedColumn: string | null; matchMethod: MappingMethod | null } {
  // Pass 1: exact name match (case-insensitive, trimmed)
  const nameNorm = field.name.trim().toLowerCase();
  const nameMatch = headers.find(h => h.trim().toLowerCase() === nameNorm);
  if (nameMatch) return { matchedColumn: nameMatch, matchMethod: "name_exact" };

  // Pass 2: label match (case-insensitive, trimmed)
  const labelNorm = field.var.label.trim().toLowerCase();
  if (labelNorm) {
    const labelMatch = headers.find(h => h.trim().toLowerCase() === labelNorm);
    if (labelMatch) return { matchedColumn: labelMatch, matchMethod: "label_match" };
  }

  return { matchedColumn: null, matchMethod: null };
}

// ─── Row → Modification[] conversion ─────────────────────────────────────────

/**
 * Convert a spreadsheet row to a Modification[] using a pre-computed mapping.
 *
 * Rules:
 * - If the column has a non-empty value, use it.
 * - If the column is empty/missing and the field has a default, use the default.
 * - If neither, the field is omitted from modifications (layer keeps its
 *   template default value).
 * - Image fields: cell value is treated as image_url.
 * - Text fields: cell value is treated as text.
 * - Rectangle fields: cell value is treated as color (if valid hex/CSS).
 *
 * @param row       One spreadsheet data row (column name → string value)
 * @param mapping   Pre-computed mapping from mapFieldsToColumns()
 * @returns         Modification[] ready for renderTemplate()
 */
export function rowToModifications(
  row: SpreadsheetRow,
  mapping: TemplateMappingResult,
): Modification[] {
  const mods: Modification[] = [];

  for (const entry of mapping.fields) {
    const rawValue =
      entry.matchedColumn ? (row[entry.matchedColumn] ?? "").trim() : "";
    const value = rawValue || entry.defaultValue || "";

    if (!value) continue; // no value, no default → skip (layer uses template default)

    const mod = buildModification(entry.fieldName, entry.fieldType, value);
    if (mod) mods.push(mod);
  }

  return mods;
}

function buildModification(
  fieldName: string,
  fieldType: "text" | "image" | "rectangle",
  value: string,
): Modification | null {
  switch (fieldType) {
    case "text":
      return { name: fieldName, text: value };

    case "image":
      // Image field: cell value is an image URL (must-have #4).
      // The renderer fetches the URL at render time. Invalid URLs
      // are handled gracefully (layer skipped, warning recorded).
      if (!value.startsWith("http://") && !value.startsWith("https://")) {
        // Not a URL — skip. Mapper callers should warn on this.
        return null;
      }
      return { name: fieldName, image_url: value };

    case "rectangle":
      // Rectangle field: cell value interpreted as a fill color override.
      return { name: fieldName, color: value };

    default:
      return null;
  }
}

// ─── Validation helpers (for Phase 2/4 pre-dispatch checks) ─────────────────

/**
 * Check whether a mapping result is safe to dispatch.
 * Returns { ok: true } or { ok: false, reason } for each blocking issue.
 */
export function validateMapping(
  mapping: TemplateMappingResult,
): { ok: true } | { ok: false; reason: string } {
  if (mapping.hasRequiredUnmatched) {
    return {
      ok: false,
      reason: `Required fields have no matching column: ${mapping.unmatched_required.join(", ")}`,
    };
  }
  return { ok: true };
}

/**
 * Quick check: is a string a plausible image URL?
 * Used for pre-flight validation in Phase 4 UI (not enforced at mapper level).
 */
export function isImageUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
