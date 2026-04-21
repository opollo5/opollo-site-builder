import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-5 — iStock catalogue ingest helper.
//
// Reads a CSV of iStock metadata and materialises:
//   - one image_library row per unique istock_id (source='istock')
//   - one transfer_jobs row of type='cloudflare_ingest'
//   - one transfer_job_items row per image, with the pre-computed
//     cloudflare + anthropic idempotency keys
//
// The cron worker (M4-3's orchestrator) then drains the job: each item
// walks upload → caption → succeeded.
//
// Idempotency contract:
//
//   1. image_library (source='istock', source_ref=istock_id) UNIQUE
//      NULLS NOT DISTINCT (migration 0010). Re-running the seed with
//      the same CSV + same job idempotency key yields the same end
//      state: existing rows are adopted, not duplicated.
//
//   2. transfer_jobs.idempotency_key UNIQUE — same key returns the
//      original job id rather than creating a new one. The caller is
//      responsible for stable key generation (the CLI hashes the CSV
//      path + line count to derive one).
//
//   3. transfer_job_items (transfer_job_id, slot_index) UNIQUE — a
//      re-run with the same job id + the same slot index is a no-op
//      on INSERT. We use ON CONFLICT DO NOTHING to skip existing rows
//      silently.
//
// Cost estimate:
//
// Caption cost per image is ~0.7 cents (Sonnet 4.6 vision at ~1200
// input tokens + ~200 output tokens per the parent plan). We bill that
// up to 1 cent/image for the pre-flight estimate so operators get a
// conservative upper bound. The default budget cap is 2× the reported
// estimate — script aborts if the estimate exceeds it. Operators can
// widen the cap explicitly when genuinely large one-time ingests land.
//
// NOTE: intentionally DOES NOT route through lib/anthropic-pricing.ts's
// `computeCostCents` for this estimate. That module's rate table
// encodes values at a scale that overstates per-image cost by ~100×
// (see docs/BACKLOG.md pricing-table-scale-audit). M4-5 uses a direct
// per-image constant so the operator-facing numbers match the plan's
// published $63 figure for 9k images. Reconciling the shared pricing
// table is a follow-up; today's runtime path (M3 + M4-4) sums cost
// from event-log deltas and isn't miscalibrated against itself.
// ---------------------------------------------------------------------------

// Per-plan cost constants — advisory for the pre-flight gate.
export const ESTIMATED_CAPTION_CENTS_PER_IMAGE = 1;
export const ESTIMATED_STORAGE_CENTS_PER_IMAGE = 0; // negligible at this scale
export const DEFAULT_BUDGET_CAP_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export const istockRowSchema = z.object({
  istock_id: z.string().min(1).max(120),
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  license_type: z.string().min(1).max(80).optional(),
});

export type IstockRow = z.infer<typeof istockRowSchema>;

export type CsvParseResult = {
  rows: IstockRow[];
  errors: Array<{ line: number; message: string }>;
};

const REQUIRED_HEADERS = ["istock_id", "url"] as const;

function splitCsvLine(line: string): string[] {
  // Minimal CSV split: supports optional double-quote quoting, handles
  // doubled quotes inside a field. No escape characters beyond that.
  // Good enough for the iStock catalogue we control; we'd graduate to
  // a proper CSV parser if the feed ever included embedded newlines.
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function parseIstockCsv(text: string): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      rows: [],
      errors: [{ line: 0, message: "CSV is empty." }],
    };
  }

  const headerCells = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !headerCells.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: `CSV header missing required column(s): ${missing.join(", ")}`,
        },
      ],
    };
  }
  const colIndex = (name: string): number => headerCells.indexOf(name);

  const rows: IstockRow[] = [];
  const errors: CsvParseResult["errors"] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const raw: Record<string, unknown> = {
      istock_id: cells[colIndex("istock_id")],
      url: cells[colIndex("url")],
    };
    const widthIdx = colIndex("width");
    const heightIdx = colIndex("height");
    const bytesIdx = colIndex("bytes");
    const licenseIdx = colIndex("license_type");
    if (widthIdx >= 0 && cells[widthIdx]) raw.width = Number(cells[widthIdx]);
    if (heightIdx >= 0 && cells[heightIdx]) raw.height = Number(cells[heightIdx]);
    if (bytesIdx >= 0 && cells[bytesIdx]) raw.bytes = Number(cells[bytesIdx]);
    if (licenseIdx >= 0 && cells[licenseIdx]) {
      raw.license_type = cells[licenseIdx];
    }

    const parsed = istockRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        line: i + 1,
        message: parsed.error.issues
          .map((it) => `${it.path.join(".")}: ${it.message}`)
          .join("; "),
      });
      continue;
    }
    rows.push(parsed.data);
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Cost estimate
// ---------------------------------------------------------------------------

export type CostEstimate = {
  imageCount: number;
  captionCents: number;
  storageCents: number;
  totalCents: number;
};

export function estimateIngestCost(imageCount: number): CostEstimate {
  const captionCents = imageCount * ESTIMATED_CAPTION_CENTS_PER_IMAGE;
  const storageCents = imageCount * ESTIMATED_STORAGE_CENTS_PER_IMAGE;
  return {
    imageCount,
    captionCents,
    storageCents,
    totalCents: captionCents + storageCents,
  };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export type SeedOptions = {
  rows: IstockRow[];
  jobIdempotencyKey: string;
  budgetCapCents?: number;
  /** If true, skip all DB writes and just return the plan. */
  dryRun?: boolean;
};

export type SeedResult = {
  jobId: string | null;
  itemsCreated: number;
  imagesCreated: number;
  imagesAdopted: number;
  estimate: CostEstimate;
  budgetCapCents: number;
  dryRun: boolean;
  skippedOverBudget: boolean;
};

export class IngestBudgetError extends Error {
  public readonly estimate: CostEstimate;
  public readonly budgetCapCents: number;
  constructor(estimate: CostEstimate, budgetCapCents: number) {
    super(
      `Estimated cost ${estimate.totalCents} cents exceeds budget cap ${budgetCapCents} cents (${estimate.imageCount} images).`,
    );
    this.name = "IngestBudgetError";
    this.estimate = estimate;
    this.budgetCapCents = budgetCapCents;
  }
}

const DEFAULT_BUDGET_FLOOR_CENTS = 2_000;

/**
 * Drive the ingest. Returns a summary; throws IngestBudgetError if the
 * estimate exceeds the cap (operator widens the cap and re-runs).
 *
 * Dry-run returns without touching the DB — the cost estimate + row
 * count is what the operator reviews before the real run.
 */
export async function seedIstockLibrary(
  options: SeedOptions,
): Promise<SeedResult> {
  const estimate = estimateIngestCost(options.rows.length);
  const budgetCap =
    options.budgetCapCents ??
    Math.max(
      estimate.totalCents * DEFAULT_BUDGET_CAP_MULTIPLIER,
      DEFAULT_BUDGET_FLOOR_CENTS,
    );

  if (estimate.totalCents > budgetCap) {
    throw new IngestBudgetError(estimate, budgetCap);
  }

  if (options.dryRun) {
    return {
      jobId: null,
      itemsCreated: 0,
      imagesCreated: 0,
      imagesAdopted: 0,
      estimate,
      budgetCapCents: budgetCap,
      dryRun: true,
      skippedOverBudget: false,
    };
  }

  const svc = getServiceRoleClient();

  // 1. Upsert image_library rows. Insert one row per istock_id; on
  //    (source='istock', source_ref=istock_id) conflict, adopt the
  //    existing id via a follow-up SELECT.
  const istockIds = Array.from(new Set(options.rows.map((r) => r.istock_id)));
  const byIstockId = new Map<string, IstockRow>();
  for (const r of options.rows) byIstockId.set(r.istock_id, r);

  // SELECT existing image_library rows matching the batch — any that
  // already have a row become "adopted"; the remainder get INSERTed.
  const { data: existing, error: exErr } = await svc
    .from("image_library")
    .select("id, source_ref")
    .eq("source", "istock")
    .in("source_ref", istockIds);
  if (exErr) {
    throw new Error(`seedIstockLibrary: load existing: ${exErr.message}`);
  }
  const existingByIstockId = new Map<string, string>();
  for (const row of existing ?? []) {
    existingByIstockId.set(row.source_ref as string, row.id as string);
  }

  const toInsert = istockIds
    .filter((id) => !existingByIstockId.has(id))
    .map((id) => {
      const r = byIstockId.get(id)!;
      return {
        source: "istock",
        source_ref: id,
        filename: id,
        width_px: r.width ?? null,
        height_px: r.height ?? null,
        bytes: r.bytes ?? null,
        license_type: r.license_type ?? null,
      };
    });

  let inserted: Array<{ id: string; source_ref: string }> = [];
  if (toInsert.length > 0) {
    const { data: insRows, error: insErr } = await svc
      .from("image_library")
      .insert(toInsert)
      .select("id, source_ref");
    if (insErr) {
      throw new Error(`seedIstockLibrary: insert images: ${insErr.message}`);
    }
    inserted = (insRows ?? []) as Array<{ id: string; source_ref: string }>;
  }

  const imageIdByIstockId = new Map(existingByIstockId);
  for (const r of inserted) {
    imageIdByIstockId.set(r.source_ref, r.id);
  }

  // 2. Get-or-create the transfer_jobs row.
  let jobId: string;
  const { data: existingJob, error: exJobErr } = await svc
    .from("transfer_jobs")
    .select("id")
    .eq("idempotency_key", options.jobIdempotencyKey)
    .maybeSingle();
  if (exJobErr) {
    throw new Error(`seedIstockLibrary: load job: ${exJobErr.message}`);
  }
  if (existingJob) {
    jobId = existingJob.id as string;
  } else {
    const { data: newJob, error: newJobErr } = await svc
      .from("transfer_jobs")
      .insert({
        type: "cloudflare_ingest",
        idempotency_key: options.jobIdempotencyKey,
        requested_count: options.rows.length,
      })
      .select("id")
      .single();
    if (newJobErr || !newJob) {
      throw new Error(`seedIstockLibrary: insert job: ${newJobErr?.message}`);
    }
    jobId = newJob.id as string;
  }

  // 3. Insert transfer_job_items (skip duplicates on (job_id, slot_index)).
  // Slot index is the row's position in the parsed CSV, stable across
  // re-runs with the same CSV ordering.
  const itemsRows = options.rows.map((r, i) => {
    const imageId = imageIdByIstockId.get(r.istock_id);
    return {
      transfer_job_id: jobId,
      slot_index: i,
      image_id: imageId ?? null,
      cloudflare_idempotency_key: `cf-${jobId}-${i}`,
      anthropic_idempotency_key: `an-${jobId}-${i}`,
      source_url: r.url,
    };
  });

  // Supabase-js `insert` doesn't ship a native ON CONFLICT DO NOTHING
  // for bulk inserts — we filter existing slots first. (For a one-shot
  // seed script this is fine; a hot path would use raw SQL.)
  const { data: existingItems, error: exItemsErr } = await svc
    .from("transfer_job_items")
    .select("slot_index")
    .eq("transfer_job_id", jobId);
  if (exItemsErr) {
    throw new Error(
      `seedIstockLibrary: load existing items: ${exItemsErr.message}`,
    );
  }
  const existingSlots = new Set(
    (existingItems ?? []).map((r) => r.slot_index as number),
  );
  const itemsToInsert = itemsRows.filter((r) => !existingSlots.has(r.slot_index));
  if (itemsToInsert.length > 0) {
    const { error: insItemsErr } = await svc
      .from("transfer_job_items")
      .insert(itemsToInsert);
    if (insItemsErr) {
      throw new Error(
        `seedIstockLibrary: insert items: ${insItemsErr.message}`,
      );
    }
  }

  return {
    jobId,
    itemsCreated: itemsToInsert.length,
    imagesCreated: inserted.length,
    imagesAdopted: existingByIstockId.size,
    estimate,
    budgetCapCents: budgetCap,
    dryRun: false,
    skippedOverBudget: false,
  };
}
