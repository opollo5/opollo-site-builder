#!/usr/bin/env -S npx tsx
/**
 * import-bulk-uploaded-images.ts
 *
 * Reads scripts/output/cloudflare-upload-results.csv (produced by
 * scripts/bulk-upload-cloudflare-images.py) and inserts a row into
 * image_library for every CSV row whose upload_status === "success".
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/import-bulk-uploaded-images.ts \
 *       --csv scripts/output/cloudflare-upload-results.csv \
 *       [--dry-run] [--confirm] [--limit N]
 *
 * Each inserted row carries:
 *   source       = 'upload'
 *   source_ref   = filename (preserves original "iStock-..." / "shutterstock_..."
 *                  provenance for later inspection)
 *   cloudflare_id = the deterministic UUIDv5 from the upload script
 *   bytes        = filesize_bytes from the CSV
 *   filename     = original basename
 *   created_by   = NULL (service-role insert, no user session)
 *
 * Idempotency. Inserts go through `upsert({ onConflict: 'cloudflare_id',
 * ignoreDuplicates: true })`. Re-running after a previous successful
 * import is a no-op.
 *
 * Pre-flight uniqueness check. image_library has BOTH
 *   UNIQUE (cloudflare_id)
 *   UNIQUE NULLS NOT DISTINCT (source, source_ref)
 * Two CSV rows with the same filename but different cloudflare_ids would
 * collide on the second constraint, not on cloudflare_id, and the
 * upsert would fail. The script scans the CSV for duplicate filenames
 * up front and aborts before any DB write if any are found.
 *
 * Without --confirm the script prints the plan and exits 2 — same
 * mental model as scripts/seed-istock-library.ts.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

type CliArgs = {
  csv: string;
  dryRun: boolean;
  confirm: boolean;
  limit?: number;
};

type CsvRow = {
  filename: string;
  filesize_bytes: number;
  cloudflare_id: string;
  upload_status: string;
  error_message: string;
  uploaded_at: string;
};

const BATCH_SIZE = 500;

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    csv: "scripts/output/cloudflare-upload-results.csv",
    dryRun: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") args.csv = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--confirm") args.confirm = true;
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
      "Usage: tsx scripts/import-bulk-uploaded-images.ts [options]",
      "  --csv <path>     Path to upload results CSV.",
      "                   (default: scripts/output/cloudflare-upload-results.csv)",
      "  --dry-run        Print plan only; no DB writes.",
      "  --limit N        Process only the first N successful rows.",
      "  --confirm        Required for real runs.",
      "",
      "Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
      "",
    ].join("\n"),
  );
}

// Minimal CSV parser. Our writer escapes nothing tricky (filenames are
// ASCII iStock-/shutterstock_-prefixed strings; error_message can be
// truncated free text but our writer wraps it through Python's csv
// module which quotes embedded commas + quotes). Reuse the same
// quoting rules here.
function parseCsv(text: string): CsvRow[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.length > 0) lines.push(current);

  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const expected = [
    "filename",
    "filesize_bytes",
    "cloudflare_id",
    "upload_status",
    "error_message",
    "uploaded_at",
  ];
  for (const col of expected) {
    if (!header.includes(col)) {
      die(`CSV missing required column: ${col}. Got: ${header.join(", ")}`);
    }
  }
  const idx = (col: string) => header.indexOf(col);
  const rows: CsvRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (line.length === 0) continue;
    const cells = splitCsvLine(line);
    rows.push({
      filename: cells[idx("filename")] ?? "",
      filesize_bytes: Number(cells[idx("filesize_bytes")] ?? "0"),
      cloudflare_id: cells[idx("cloudflare_id")] ?? "",
      upload_status: cells[idx("upload_status")] ?? "",
      error_message: cells[idx("error_message")] ?? "",
      uploaded_at: cells[idx("uploaded_at")] ?? "",
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = resolve(args.csv);
  if (!existsSync(csvPath)) die(`CSV not found: ${csvPath}`);

  const text = readFileSync(csvPath, "utf8");
  const allRows = parseCsv(text);

  const counts = {
    total: allRows.length,
    success: 0,
    non_success: 0,
  };
  const successRows: CsvRow[] = [];
  for (const r of allRows) {
    if (r.upload_status === "success") {
      counts.success += 1;
      successRows.push(r);
    } else {
      counts.non_success += 1;
    }
  }

  // Pre-flight: detect duplicate filenames among success rows (would
  // collide on the (source, source_ref) constraint).
  const seen = new Map<string, string>();
  const duplicates: Array<{ filename: string; ids: [string, string] }> = [];
  for (const r of successRows) {
    const prev = seen.get(r.filename);
    if (prev && prev !== r.cloudflare_id) {
      duplicates.push({ filename: r.filename, ids: [prev, r.cloudflare_id] });
    } else if (!prev) {
      seen.set(r.filename, r.cloudflare_id);
    }
  }

  const limited =
    typeof args.limit === "number" ? successRows.slice(0, args.limit) : successRows;

  process.stdout.write(
    [
      "image_library import plan",
      `  CSV:                ${csvPath}`,
      `  Total CSV rows:     ${counts.total}`,
      `  Success rows:       ${counts.success}`,
      `  Non-success rows:   ${counts.non_success}  (skipped)`,
      `  Will insert (cap):  ${limited.length}`,
      `  Duplicate filenames: ${duplicates.length}`,
      "",
    ].join("\n"),
  );

  if (duplicates.length > 0) {
    process.stderr.write(
      `ABORT: ${duplicates.length} filename(s) appear with different cloudflare_ids.\n` +
        `These would collide on UNIQUE (source, source_ref) at insert time.\n` +
        `First few:\n` +
        duplicates
          .slice(0, 5)
          .map(
            (d) =>
              `  ${d.filename}: ids=${d.ids[0]} vs ${d.ids[1]}`,
          )
          .join("\n") +
        "\n",
    );
    return 2;
  }

  if (args.dryRun) {
    process.stdout.write("Dry-run — no DB writes performed.\n");
    return 0;
  }
  if (!args.confirm) {
    process.stderr.write(
      "Pass --confirm to execute the real import, or --dry-run to preview.\n",
    );
    return 2;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die("SUPABASE_URL is not set.");
  if (!serviceRoleKey) die("SUPABASE_SERVICE_ROLE_KEY is not set.");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let inserted = 0;
  let attempted = 0;
  for (let i = 0; i < limited.length; i += BATCH_SIZE) {
    const slice = limited.slice(i, i + BATCH_SIZE);
    const payload = slice.map((r) => ({
      cloudflare_id: r.cloudflare_id,
      filename: r.filename,
      source: "upload" as const,
      source_ref: r.filename,
      bytes: r.filesize_bytes,
    }));
    const { error, data } = await supabase
      .from("image_library")
      .upsert(payload, { onConflict: "cloudflare_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      die(
        `upsert image_library failed at batch starting index ${i}: ` +
          `${error.message}`,
      );
    }
    attempted += slice.length;
    inserted += data?.length ?? 0;
    process.stdout.write(
      `  [${attempted}/${limited.length}] batch upserted; ` +
        `inserted_so_far=${inserted}\n`,
    );
  }

  process.stdout.write(
    [
      "",
      "Import complete",
      `  Rows attempted:     ${attempted}`,
      `  Rows inserted:      ${inserted}`,
      `  Rows skipped (existing): ${attempted - inserted}`,
      `  Non-success skipped:     ${counts.non_success}`,
      `  Total processed:    ${counts.total}`,
      "",
    ].join("\n"),
  );

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("import-bulk-uploaded-images: fatal error");
    console.error(err);
    process.exit(1);
  },
);
