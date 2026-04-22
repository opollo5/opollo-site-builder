#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  IngestBudgetError,
  estimateIngestCost,
  parseIstockCsv,
  seedIstockLibrary,
} from "@/lib/istock-seed";

// ---------------------------------------------------------------------------
// scripts/seed-istock-library.ts
//
// One-shot CLI that parses an iStock CSV and materialises the image
// library + a cloudflare_ingest transfer_jobs row + one
// transfer_job_items row per image. The worker cron drains the job.
//
// Usage:
//
//   tsx scripts/seed-istock-library.ts \
//     --csv path/to/istock.csv \
//     [--dry-run] \
//     [--budget-cap-cents N] \
//     [--job-key <string>] \
//     [--limit N] \
//     [--confirm]
//
// Flow:
//
//   1. Parse the CSV. Abort loudly on header errors; report per-line
//      errors but continue with valid rows.
//
//   2. Print the cost estimate and row count. In dry-run mode, exit.
//
//   3. In real-run mode, require --confirm. Without it the script
//      prints the estimate and exits 0 — same mental model as a
//      migration preview.
//
//   4. Call seedIstockLibrary. If the estimate exceeds the budget cap,
//      IngestBudgetError is thrown and we exit non-zero. Operator
//      widens the cap explicitly.
//
// Idempotency:
//
//   The job's idempotency_key defaults to sha256(csv basename + row
//   count). Re-running with the same CSV adopts the same job id;
//   previously-processed items stay processed; new rows (if the CSV
//   was extended) get appended. Operators can pass --job-key to force
//   a specific key (e.g. for second-half ingests of the same catalogue).
// ---------------------------------------------------------------------------

type CliArgs = {
  csv?: string;
  dryRun: boolean;
  budgetCapCents?: number;
  jobKey?: string;
  limit?: number;
  confirm: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--budget-cap-cents") {
      args.budgetCapCents = Number(argv[++i]);
    } else if (a === "--job-key") args.jobKey = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      printUsage();
      process.exit(2);
    }
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: tsx scripts/seed-istock-library.ts --csv <path> [options]",
      "  --csv <path>            Required. Path to the iStock CSV.",
      "  --dry-run               Report estimate + row count; no DB writes.",
      "  --budget-cap-cents N    Abort if estimate exceeds this cap.",
      "  --job-key <string>      Override the computed idempotency key.",
      "  --limit N               Process only the first N rows (debugging).",
      "  --confirm               Required for real runs (opt-in guard).",
      "",
    ].join("\n"),
  );
}

function computeDefaultJobKey(csvPath: string, rowCount: number): string {
  const h = createHash("sha256");
  h.update(basename(csvPath));
  h.update("|");
  h.update(String(rowCount));
  return `istock-seed-${h.digest("hex").slice(0, 32)}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv) {
    printUsage();
    return 2;
  }

  const text = readFileSync(args.csv, "utf8");
  const parsed = parseIstockCsv(text);
  if (parsed.errors.length > 0) {
    process.stderr.write(
      `Parse errors (${parsed.errors.length}):\n` +
        parsed.errors
          .slice(0, 20)
          .map((e) => `  line ${e.line}: ${e.message}`)
          .join("\n") +
        (parsed.errors.length > 20 ? "\n  ...(truncated)" : "") +
        "\n",
    );
    if (parsed.rows.length === 0) return 2;
  }

  const rows =
    typeof args.limit === "number" ? parsed.rows.slice(0, args.limit) : parsed.rows;

  const estimate = estimateIngestCost(rows.length);
  const jobKey = args.jobKey ?? computeDefaultJobKey(args.csv, rows.length);

  process.stdout.write(
    [
      "iStock ingest plan",
      `  CSV: ${args.csv}`,
      `  Rows: ${rows.length}`,
      `  Estimated caption cost: ${(estimate.captionCents / 100).toFixed(2)} USD (${estimate.captionCents} cents)`,
      `  Storage estimate: ${(estimate.storageCents / 100).toFixed(2)} USD`,
      `  Total estimate: ${(estimate.totalCents / 100).toFixed(2)} USD`,
      `  Budget cap: ${args.budgetCapCents ?? "(auto: 2× estimate, floor 2000 cents)"}`,
      `  Idempotency key: ${jobKey}`,
      "",
    ].join("\n"),
  );

  if (args.dryRun) {
    process.stdout.write("Dry-run — no DB writes performed.\n");
    return 0;
  }
  if (!args.confirm) {
    process.stderr.write(
      "Pass --confirm to execute the real run, or --dry-run to re-estimate.\n",
    );
    return 2;
  }

  try {
    const result = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: jobKey,
      budgetCapCents: args.budgetCapCents,
    });
    process.stdout.write(
      [
        "Seed complete",
        `  Job id: ${result.jobId}`,
        `  Images created: ${result.imagesCreated}`,
        `  Images adopted (existing): ${result.imagesAdopted}`,
        `  Transfer items created: ${result.itemsCreated}`,
        `  Effective budget cap: ${result.budgetCapCents} cents`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    if (err instanceof IngestBudgetError) {
      process.stderr.write(
        `\nABORTED: ${err.message}\n` +
          `Pass --budget-cap-cents <N> to raise the cap if this estimate is acceptable.\n`,
      );
      return 3;
    }
    throw err;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("seed-istock-library: fatal error");
    console.error(err);
    process.exit(1);
  },
);
