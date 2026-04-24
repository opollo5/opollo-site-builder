"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BriefPageRow, BriefRow } from "@/lib/briefs";

// ---------------------------------------------------------------------------
// M12-1 — client component for the brief-review page.
//
// State machine (follows docs/patterns/assistive-operator-flow.md):
//
//   briefs.status='parsing'       → banner "Reading your brief…"
//                                   (parse is synchronous in M12-1 so
//                                    this is defensive — only appears
//                                    if someone lands on the URL while
//                                    the upload route is still in flight)
//
//   briefs.status='parsed'        → editable list + "Commit page list" CTA
//
//   briefs.status='committed'     → read-only list, start-run CTA disabled
//                                   with an "Available in M12-5" tooltip
//
//   briefs.status='failed_parse'  → red banner with the failure detail +
//                                   re-upload suggestion
//
// Commit flow: the client computes page_hash locally exactly the same
// way the server recomputes it (see lib/briefs.computePageHash), opens
// the confirmation modal, POSTs /api/briefs/[brief_id]/commit, handles
// VERSION_CONFLICT / ALREADY_EXISTS responses.
// ---------------------------------------------------------------------------

type EditablePage = BriefPageRow & { localKey: string };

function toEditable(pages: BriefPageRow[]): EditablePage[] {
  return pages.map((p) => ({ ...p, localKey: p.id }));
}

// SHA256 via the SubtleCrypto API so the browser doesn't need a polyfill.
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computePageHash(
  pages: Array<Pick<EditablePage, "ordinal" | "title" | "mode" | "source_text">>,
): Promise<string> {
  const ordered = [...pages].sort((a, b) => a.ordinal - b.ordinal);
  const resolved = await Promise.all(
    ordered.map(async (p) => ({
      ordinal: p.ordinal,
      title: p.title,
      mode: p.mode,
      source_sha256: await sha256Hex(p.source_text),
    })),
  );
  return sha256Hex(JSON.stringify(resolved));
}

type CommitState = "idle" | "confirming" | "committing";

const PARSE_FAILURE_TRANSLATIONS: Record<string, string> = {
  EMPTY_DOCUMENT: "Your brief is empty. Upload a file with content and try again.",
  NO_PARSABLE_STRUCTURE:
    "We couldn't find pages in your brief. Try separating pages with `## Page title` headings or `---` lines, then re-upload.",
  INFERENCE_FALLBACK_FAILED:
    "We couldn't find pages in your brief. Try separating pages with `## Page title` headings or `---` lines, then re-upload.",
  BRIEF_TOO_LARGE:
    "That brief is too large. The 10 MB / 60k-token cap is there so the generator can keep the whole document in context. Trim it and try again.",
};

const ERROR_TRANSLATIONS: Record<string, string> = {
  VERSION_CONFLICT:
    "Someone else edited this brief's page list while you were reviewing. Refresh to see the latest version, then commit.",
  ALREADY_EXISTS:
    "This brief is already committed. Start a new brief to change the page list.",
};

export function BriefReviewClient({
  siteId,
  siteName,
  brief,
  initialPages,
}: {
  siteId: string;
  siteName: string;
  brief: BriefRow;
  initialPages: BriefPageRow[];
}) {
  const router = useRouter();
  const [pages, setPages] = useState<EditablePage[]>(() => toEditable(initialPages));
  const [commitState, setCommitState] = useState<CommitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // M12-2 — brand_voice + design_direction feed the M12-3 runner. Captured
  // pre-commit; editable here while status='parsed', read-only after commit.
  const [brandVoice, setBrandVoice] = useState<string>(
    brief.brand_voice ?? "",
  );
  const [designDirection, setDesignDirection] = useState<string>(
    brief.design_direction ?? "",
  );

  const isReadOnly = brief.status === "committed";
  const isFailed = brief.status === "failed_parse";
  const isParsing = brief.status === "parsing";

  const warnings = Array.isArray(brief.parser_warnings) ? brief.parser_warnings : [];

  const failureMessage =
    isFailed && brief.parse_failure_code
      ? PARSE_FAILURE_TRANSLATIONS[brief.parse_failure_code] ??
        brief.parse_failure_detail ??
        "Parsing failed."
      : null;

  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.ordinal - b.ordinal),
    [pages],
  );

  function setPage(localKey: string, patch: Partial<EditablePage>) {
    setPages((prev) =>
      prev.map((p) => (p.localKey === localKey ? { ...p, ...patch } : p)),
    );
  }

  function removePage(localKey: string) {
    setPages((prev) => {
      const remaining = prev.filter((p) => p.localKey !== localKey);
      return remaining
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((p, i) => ({ ...p, ordinal: i }));
    });
  }

  function movePage(localKey: string, direction: -1 | 1) {
    setPages((prev) => {
      const sorted = [...prev].sort((a, b) => a.ordinal - b.ordinal);
      const idx = sorted.findIndex((p) => p.localKey === localKey);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= sorted.length) return prev;
      const [item] = sorted.splice(idx, 1);
      sorted.splice(newIdx, 0, item);
      return sorted.map((p, i) => ({ ...p, ordinal: i }));
    });
  }

  async function handleCommit() {
    setCommitState("committing");
    setErrorMessage(null);
    try {
      const hash = await computePageHash(sortedPages);
      // Normalise empty strings to null so the server treats "operator
      // opened the field, typed, then cleared" the same as "never
      // touched". The server-side schema accepts both shapes.
      const voiceValue = brandVoice.trim() === "" ? null : brandVoice;
      const directionValue =
        designDirection.trim() === "" ? null : designDirection;
      const res = await fetch(`/api/briefs/${brief.id}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: brief.version_lock,
          page_hash: hash,
          brand_voice: voiceValue,
          design_direction: directionValue,
        }),
      });
      const payload = (await res.json()) as {
        ok: boolean;
        data?: unknown;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setCommitState("idle");
        router.refresh();
        return;
      }
      const code = payload.error?.code ?? "INTERNAL_ERROR";
      setErrorMessage(
        ERROR_TRANSLATIONS[code] ?? payload.error?.message ?? `Commit failed (HTTP ${res.status}).`,
      );
      setCommitState("idle");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setCommitState("idle");
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{brief.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Brief for <span className="font-medium">{siteName}</span> —{" "}
            <StatusPill status={brief.status} />
          </p>
        </div>
      </div>

      {isParsing && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4 text-sm" role="status">
          <p className="font-medium">Reading your brief…</p>
          <p className="mt-1 text-muted-foreground">
            We&apos;re parsing the file. This page will refresh when parsing completes.
          </p>
        </div>
      )}

      {isFailed && failureMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">We couldn&apos;t parse this brief.</p>
          <p className="mt-1">{failureMessage}</p>
          <p className="mt-3">
            <a
              href={`/admin/sites/${siteId}`}
              className="underline hover:no-underline"
            >
              Back to site overview
            </a>{" "}
            to upload a new version.
          </p>
        </div>
      )}

      {warnings.length > 0 && !isFailed && (
        <div
          role="status"
          className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-200"
        >
          <p className="font-medium">Parser warnings:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.map((w: { code: string; detail?: string }, i: number) => (
              <li key={i}>
                <code className="text-xs">{w.code}</code>
                {w.detail ? <>: {w.detail}</> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {(brief.status === "parsed" || brief.status === "committed") && (
        <section aria-labelledby="voice-direction-heading" className="rounded-lg border p-4">
          <div className="mb-3">
            <h2 id="voice-direction-heading" className="text-lg font-medium">
              Brand voice &amp; design direction
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These guide every page the generator produces. Optional today;
              required before the runner ships in M12-3.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="brand-voice-input"
                className="block text-xs font-medium text-muted-foreground"
              >
                Brand voice
              </label>
              <Textarea
                id="brand-voice-input"
                className="mt-1"
                rows={5}
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                disabled={isReadOnly}
                placeholder="e.g. Warm, confident, plain language. Avoid jargon. Second-person (you / your) by default."
                aria-describedby="brand-voice-hint"
              />
              <p
                id="brand-voice-hint"
                className="mt-1 text-xs text-muted-foreground"
              >
                How every page should sound. 4 KB max.
              </p>
            </div>
            <div>
              <label
                htmlFor="design-direction-input"
                className="block text-xs font-medium text-muted-foreground"
              >
                Design direction
              </label>
              <Textarea
                id="design-direction-input"
                className="mt-1"
                rows={5}
                value={designDirection}
                onChange={(e) => setDesignDirection(e.target.value)}
                disabled={isReadOnly}
                placeholder="e.g. Generous white space. Hero with photo background. Single CTA per section, accent color for emphasis."
                aria-describedby="design-direction-hint"
              />
              <p
                id="design-direction-hint"
                className="mt-1 text-xs text-muted-foreground"
              >
                Constrains the anchor cycle on page 1, then re-used verbatim
                for pages 2..N. 4 KB max.
              </p>
            </div>
          </div>
        </section>
      )}

      {(brief.status === "parsed" || brief.status === "committed") && (
        <section aria-label="Page list">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Page list</h2>
            <p className="text-xs text-muted-foreground">
              {sortedPages.length} page{sortedPages.length === 1 ? "" : "s"}
            </p>
          </div>

          <ol className="space-y-4">
            {sortedPages.map((p) => (
              <li key={p.localKey} className="rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 shrink-0 text-center text-xs text-muted-foreground pt-2">
                    {p.ordinal + 1}
                  </div>

                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Page title
                      </label>
                      <Input
                        className="mt-1"
                        value={p.title}
                        onChange={(e) => setPage(p.localKey, { title: e.target.value })}
                        disabled={isReadOnly}
                        aria-label={`Title for page ${p.ordinal + 1}`}
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <ModePill
                        mode={p.mode}
                        disabled={isReadOnly}
                        onToggle={() =>
                          setPage(p.localKey, {
                            mode: p.mode === "full_text" ? "short_brief" : "full_text",
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {p.word_count} word{p.word_count === 1 ? "" : "s"}
                      </span>
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Show source excerpt
                      </summary>
                      <Textarea
                        className="mt-2 text-xs"
                        value={p.source_text}
                        readOnly
                        rows={Math.min(12, Math.max(3, p.source_text.split("\n").length))}
                      />
                    </details>
                  </div>

                  {!isReadOnly && (
                    <div className="flex flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => movePage(p.localKey, -1)}
                        aria-label={`Move page ${p.ordinal + 1} up`}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => movePage(p.localKey, 1)}
                        aria-label={`Move page ${p.ordinal + 1} down`}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePage(p.localKey)}
                        aria-label={`Remove page ${p.ordinal + 1}`}
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {brief.status === "parsed" && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="default"
            onClick={() => setCommitState("confirming")}
            disabled={sortedPages.length === 0}
          >
            Commit page list
          </Button>
        </div>
      )}

      {brief.status === "committed" && (
        <div
          className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm"
          role="status"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">This brief is locked in.</p>
              <p className="mt-1 text-muted-foreground">
                Page generation will be available soon — we&apos;ll email you when it&apos;s ready.
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="shrink-0"
            >
              <a href={`/admin/sites/${siteId}`}>
                Back to briefs
              </a>
            </Button>
          </div>
        </div>
      )}

      {commitState === "confirming" && (
        <CommitConfirmModal
          pageCount={sortedPages.length}
          firstPageTitle={sortedPages[0]?.title ?? ""}
          onCancel={() => setCommitState("idle")}
          onConfirm={handleCommit}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: BriefRow["status"] }) {
  const labels: Record<BriefRow["status"], { label: string; cls: string }> = {
    parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
    parsed: { label: "Awaiting review", cls: "bg-primary/10 text-primary" },
    committed: { label: "Committed", cls: "bg-emerald-500/10 text-emerald-700" },
    failed_parse: { label: "Parse failed", cls: "bg-destructive/10 text-destructive" },
  };
  const l = labels[status];
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${l.cls}`}
    >
      {l.label}
    </span>
  );
}

function ModePill({
  mode,
  disabled,
  onToggle,
}: {
  mode: "full_text" | "short_brief";
  disabled: boolean;
  onToggle: () => void;
}) {
  const label = mode === "full_text" ? "Full text" : "Short brief";
  const description =
    mode === "full_text"
      ? "The brief contains the entire page copy; the runner will render it verbatim."
      : "The brief only sketches this page; the runner will expand it from the outline.";
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      onClick={onToggle}
      disabled={disabled}
      title={description}
      aria-label={`Mode: ${label}. Click to toggle.`}
    >
      {label}
    </button>
  );
}

function CommitConfirmModal({
  pageCount,
  firstPageTitle,
  onCancel,
  onConfirm,
}: {
  pageCount: number;
  firstPageTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    await onConfirm();
    setSubmitting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="commit-confirm-title" className="text-lg font-semibold">
          Commit this page list?
        </h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>
            After committing, the page list is locked. You won&apos;t be able to
            reorder or edit pages without cancelling the run and starting a new
            brief.
          </p>
          <p>
            You&apos;ll then be able to start a generation run from this brief.
            Starting the run will spend Anthropic tokens — the brief runner
            makes up to 5 Claude calls per page. Estimated cost is shown on the
            run surface.
          </p>
          <p className="text-foreground">
            Committing: <span className="font-semibold">{pageCount}</span>{" "}
            page{pageCount === 1 ? "" : "s"}; first page is{" "}
            <span className="font-semibold">&quot;{firstPageTitle}&quot;</span>.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Committing…" : "Commit page list"}
          </Button>
        </div>
      </div>
    </div>
  );
}
