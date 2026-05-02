"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ACCEPTED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BATCH_SIZE = 10;

type DupePolicy = "skip" | "replace" | "ask";

type FileState =
  | "queued"
  | "checking"
  | "ask"
  | "uploading"
  | "done"
  | "skipped"
  | "replaced"
  | "failed";

type FileRow = {
  id: string;
  file: File;
  state: FileState;
  message?: string;
  existingImageId?: string;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function newFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAccepted(file: File): boolean {
  if (ACCEPTED_TYPES.has(file.type.toLowerCase())) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

export function BulkImageUpload() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [policy, setPolicy] = useState<DupePolicy>("skip");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [running, setRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const done = rows.filter((r) => r.state === "done" || r.state === "replaced").length;
    const skipped = rows.filter((r) => r.state === "skipped").length;
    const failed = rows.filter((r) => r.state === "failed").length;
    return { total: rows.length, done, skipped, failed };
  }, [rows]);

  const updateRow = useCallback(
    (id: string, patch: Partial<FileRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const toAdd: FileRow[] = [];
    for (const file of Array.from(files)) {
      if (!isAccepted(file)) continue;
      if (file.size === 0) continue;
      if (file.size > MAX_FILE_BYTES) {
        toAdd.push({
          id: newFileId(),
          file,
          state: "failed",
          message: `Exceeds 10 MB cap (${fmtBytes(file.size)}).`,
        });
        continue;
      }
      toAdd.push({ id: newFileId(), file, state: "queued" });
    }
    if (toAdd.length > 0) {
      setRows((prev) => [...prev, ...toAdd]);
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
    },
    [addFiles],
  );

  async function checkDuplicates(rowsToCheck: FileRow[]): Promise<Map<string, string>> {
    const filenames = rowsToCheck.map((r) => r.file.name);
    const res = await fetch("/api/admin/images/check-existing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filenames }),
    });
    if (!res.ok) return new Map();
    const payload = (await res.json().catch(() => null)) as
      | { ok: true; data: { existing: Array<{ filename: string; image_id: string }> } }
      | null;
    if (!payload?.ok) return new Map();
    const map = new Map<string, string>();
    for (const e of payload.data.existing) map.set(e.filename, e.image_id);
    return map;
  }

  async function uploadOne(row: FileRow, replace: boolean): Promise<{ ok: boolean; message?: string }> {
    const url = `/api/admin/images/upload${replace ? "?replace=1" : ""}`;
    const body = new FormData();
    body.append("file", row.file);
    const res = await fetch(url, { method: "POST", body });
    const payload = (await res.json().catch(() => null)) as
      | { ok: true; data: unknown }
      | { ok: false; error: { code: string; message: string } }
      | null;
    if (res.ok && payload && payload.ok) return { ok: true };
    const message =
      payload && payload.ok === false
        ? payload.error.message
        : `HTTP ${res.status}`;
    return { ok: false, message };
  }

  async function startUpload() {
    if (running) return;
    setRunning(true);

    const queued = rows.filter((r) => r.state === "queued");
    if (queued.length === 0) {
      setRunning(false);
      return;
    }

    for (const r of queued) updateRow(r.id, { state: "checking" });
    const dupMap = await checkDuplicates(queued);

    // Apply the duplicate policy in one pass before upload starts.
    const decided = queued.map((r) => {
      const existing = dupMap.get(r.file.name);
      if (!existing) return { row: r, action: "upload" as const, replace: false };
      if (policy === "skip") return { row: r, action: "skip" as const, replace: false, existing };
      if (policy === "replace")
        return { row: r, action: "upload" as const, replace: true, existing };
      return { row: r, action: "ask" as const, replace: false, existing };
    });

    for (const d of decided) {
      if (d.action === "skip") {
        updateRow(d.row.id, {
          state: "skipped",
          message: "Already exists — skipped.",
          existingImageId: d.existing,
        });
      } else if (d.action === "ask") {
        updateRow(d.row.id, {
          state: "ask",
          message: "Already exists — choose Replace or Skip.",
          existingImageId: d.existing,
        });
      } else {
        updateRow(d.row.id, { state: "uploading", existingImageId: d.existing });
      }
    }

    const toUpload = decided.filter((d) => d.action === "upload");
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (d) => {
          const result = await uploadOne(d.row, d.replace);
          if (result.ok) {
            updateRow(d.row.id, {
              state: d.replace ? "replaced" : "done",
              message: d.replace ? "Replaced existing." : undefined,
            });
          } else {
            updateRow(d.row.id, {
              state: "failed",
              message: result.message ?? "Upload failed.",
            });
          }
        }),
      );
    }

    setRunning(false);
    startTransition(() => router.refresh());
  }

  async function resolveAsk(rowId: string, decision: "skip" | "replace") {
    const row = rows.find((r) => r.id === rowId);
    if (!row || row.state !== "ask") return;
    if (decision === "skip") {
      updateRow(rowId, { state: "skipped", message: "Skipped by operator." });
      return;
    }
    updateRow(rowId, { state: "uploading", message: "Replacing…" });
    const result = await uploadOne(row, true);
    updateRow(rowId, {
      state: result.ok ? "replaced" : "failed",
      message: result.ok ? "Replaced existing." : result.message ?? "Upload failed.",
    });
    startTransition(() => router.refresh());
  }

  function clearFinished() {
    setRows((prev) =>
      prev.filter(
        (r) =>
          r.state === "queued" ||
          r.state === "uploading" ||
          r.state === "checking" ||
          r.state === "ask",
      ),
    );
  }

  return (
    <section
      className="mt-6 rounded-md border bg-muted/20 p-4"
      data-testid="bulk-image-upload"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Bulk upload</h2>
          <p className="text-sm text-muted-foreground">
            Drag images here, or click to pick. Up to 10 MB each. JPEG / PNG / WebP / GIF.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          On duplicate
          <select
            value={policy}
            onChange={(e) => setPolicy(e.target.value as DupePolicy)}
            disabled={running}
            className="h-7 rounded border bg-background px-2 text-sm"
            data-testid="bulk-upload-policy"
          >
            <option value="skip">Skip all</option>
            <option value="replace">Replace all</option>
            <option value="ask">Ask each time</option>
          </select>
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`mt-3 flex h-28 cursor-pointer items-center justify-center rounded border-2 border-dashed text-sm transition-smooth ${
          dragActive
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/40 hover:border-muted-foreground"
        }`}
        data-testid="bulk-upload-dropzone"
      >
        {dragActive
          ? "Drop to add to the queue"
          : "Drop images here or click to pick"}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Button
          type="button"
          size="sm"
          onClick={() => void startUpload()}
          disabled={running || rows.every((r) => r.state !== "queued")}
          data-testid="bulk-upload-start"
        >
          {running
            ? `Uploading ${summary.done + summary.skipped}/${summary.total}…`
            : `Upload ${rows.filter((r) => r.state === "queued").length} queued`}
        </Button>
        {rows.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clearFinished}
            disabled={running}
          >
            Clear finished
          </Button>
        )}
        {rows.length > 0 && (
          <span className="text-muted-foreground">
            {summary.done} uploaded · {summary.skipped} skipped · {summary.failed} failed · of {summary.total}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <ul
          className="mt-3 space-y-1 text-sm"
          data-testid="bulk-upload-list"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-3 py-1.5"
              data-state={row.state}
              data-testid={`bulk-upload-row-${row.state}`}
            >
              <span className="truncate">
                <strong className="font-medium">{row.file.name}</strong>{" "}
                <span className="text-muted-foreground">
                  ({fmtBytes(row.file.size)})
                </span>
              </span>
              <span className="flex items-center gap-2">
                <StateBadge state={row.state} />
                {row.message && (
                  <span className="text-muted-foreground">{row.message}</span>
                )}
                {row.state === "ask" && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolveAsk(row.id, "skip")}
                    >
                      Skip
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolveAsk(row.id, "replace")}
                    >
                      Replace
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StateBadge({ state }: { state: FileState }) {
  const palette: Record<FileState, string> = {
    queued: "bg-muted text-muted-foreground",
    checking: "bg-muted text-muted-foreground",
    ask: "bg-amber-100 text-amber-900",
    uploading: "bg-blue-100 text-blue-900",
    done: "bg-emerald-100 text-emerald-900",
    skipped: "bg-muted text-muted-foreground",
    replaced: "bg-emerald-100 text-emerald-900",
    failed: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${palette[state]}`}
    >
      {state}
    </span>
  );
}
