/**
 * template-bulk-types — shared types for Stream B template-based bulk generation.
 *
 * These types are used across:
 *  - lib/image/template-field-mapper.ts  (column → modification mapping)
 *  - lib/image/dispatch.ts               (TemplateJobSpec in batch dispatch)
 *  - lib/image/enqueue.ts                (template job payload to QStash)
 *  - app/api/internal/image/qstash-handler (template job execution)
 *  - app/api/platform/image/ingest       (template-mode ingest route)
 *
 * No server-only import — these types are safe in both client and server code.
 */

import type { Modification } from "@/lib/image/template-model";

// ─── Spreadsheet parsing types ────────────────────────────────────────────────

/** A raw row from a parsed XLSX/DOCX spreadsheet. */
export type SpreadsheetRow = Record<string, string>;

// ─── Template job spec (extends existing Ideogram DispatchJobSpec) ────────────

/**
 * Job specification for a template-based render job.
 * Dispatched to QStash with jobType="template".
 *
 * Design: additive alongside DispatchJobSpec (no renaming of existing types).
 * The existing Ideogram pipeline is untouched.
 */
export interface TemplateJobSpec {
  jobType: "template";
  templateId: string;
  /** Variant key (e.g. "square" | "landscape"). Null = base canvas. */
  variantKey?: string;
  /** Layer modifications derived from a spreadsheet row via the field mapper. */
  modifications: Modification[];
  /** Aspect ratio carried for budget/storage-path conventions. */
  aspectRatio: string;
  targetPlatforms?: string[];
  targetPublishDate?: string;
  parentPostIndex?: number;
}

// ─── Column mapping result ────────────────────────────────────────────────────

/** How a template field was matched to a spreadsheet column. */
export type MappingMethod = "name_exact" | "label_match";

/** Result for a single template field after column mapping. */
export interface FieldMappingEntry {
  /** Template field name (= Modification.name key). */
  fieldName: string;
  /** Human-readable label from var metadata. */
  fieldLabel: string;
  /** Field type — text, image, or rectangle. */
  fieldType: "text" | "image" | "rectangle";
  /** Whether the field is marked required in var metadata. */
  required: boolean;
  /** Default value from var metadata (empty string if none). */
  defaultValue: string;
  /** Which spreadsheet column was matched. Null = no match found. */
  matchedColumn: string | null;
  /** How the match was made (null if no match). */
  matchMethod: MappingMethod | null;
  /** Sample value from the first spreadsheet row (for UI preview). */
  sampleValue: string | null;
}

/** Overall mapping result for a template + spreadsheet header set. */
export interface TemplateMappingResult {
  /** Entries for every template field (matched or unmatched). */
  fields: FieldMappingEntry[];
  /** Columns in the spreadsheet that did not map to any template field. */
  unusedColumns: string[];
  /** True if any required field has no matching column. */
  hasRequiredUnmatched: boolean;
  /** Template fields with required=true and no column match. */
  unmatched_required: string[];
}

// ─── Image URL warning (must-have #4) ────────────────────────────────────────

/**
 * Warning recorded when an image layer URL fails to fetch during rendering.
 * Written to image_generation_jobs.error_detail as JSON so the batch results
 * UI can surface warnings without failing the whole job.
 */
export interface ImageLayerWarning {
  layerName: string;
  url: string;
  reason: "fetch_failed" | "not_reachable" | "invalid_url" | "no_url";
  httpStatus?: number;
}

/** Shape stored in image_generation_jobs.error_detail when job completes with warnings. */
export interface JobCompletionWarnings {
  imageLayerWarnings: ImageLayerWarning[];
}
