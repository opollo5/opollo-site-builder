"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  StatusPill as UIStatusPill,
  briefStatusKind,
} from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import type { BriefPageRow, BriefRow } from "@/lib/briefs";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from "@/lib/anthropic-models";

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
//   briefs.status='committed'     → operator never sees this page; the
//                                   /review route redirects to /run
//                                   server-side, and the commit handler
//                                   pushes to /run on success (RS-3).
//                                   The DB-level state still exists.
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
  siteBrandVoiceDefault,
  siteDesignDirectionDefault,
  brief,
  initialPages,
}: {
  siteId: string;
  siteName: string;
  siteBrandVoiceDefault: string | null;
  siteDesignDirectionDefault: string | null;
  brief: BriefRow;
  initialPages: BriefPageRow[];
}) {
  const router = useRouter();
  const [pages, setPages] = useState<EditablePage[]>(() => toEditable(initialPages));
  const [commitState, setCommitState] = useState<CommitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  // Track the latest brief state (especially version_lock after save draft).
  const [latestBrief, setLatestBrief] = useState<BriefRow>(brief);
  // M12-2 — brand_voice + design_direction feed the M12-3 runner. Captured
  // pre-commit; editable here while status='parsed', read-only after commit.
  //
  // RS-2 — site-level defaults inherit when the brief row has no
  // override yet. The operator can then "Customize for this brief"
  // (collapsed by default whenever a site default exists) which keeps
  // their override on the briefs row, never touching the site row.
  const [brandVoice, setBrandVoice] = useState<string>(
    brief.brand_voice ?? siteBrandVoiceDefault ?? "",
  );
  const [designDirection, setDesignDirection] = useState<string>(
    brief.design_direction ?? siteDesignDirectionDefault ?? "",
  );
  const hasSiteDefault =
    (siteBrandVoiceDefault ?? "").length > 0 ||
    (siteDesignDirectionDefault ?? "").length > 0;
  const hasPerBriefOverride =
    brief.brand_voice !== null || brief.design_direction !== null;
  // Collapse the editor when site defaults exist AND the brief hasn't
  // already been overridden — operators land on a clean "inheriting"
  // state and only expand when they want to deviate.
  const [voiceOverrideOpen, setVoiceOverrideOpen] = useState<boolean>(
    !hasSiteDefault || hasPerBriefOverride,
  );
  // M12-5 — operator picks model tiers at commit time. Default to the
  // value the server committed the brief with; fall back to the cheap
  // default (Haiku) when a row has no value, so dev/UAT runs don't
  // accidentally spend Sonnet/Opus money. Operator opts up explicitly.
  const [textModel, setTextModel] = useState<string>(
    brief.text_model ?? DEFAULT_MODEL_ID,
  );
  const [visualModel, setVisualModel] = useState<string>(
    brief.visual_model ?? DEFAULT_MODEL_ID,
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

  async function handleSaveDraft() {
    setIsSavingDraft(true);
    setErrorMessage(null);
    try {
      const pageUpdates = sortedPages.map((p) => ({
        id: p.id,
        title: p.title,
        mode: p.mode,
        source_text: p.source_text,
        operator_notes: p.operator_notes,
      }));

      const res = await fetch(`/api/briefs/${brief.id}/pages`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: brief.version_lock,
          pages: pageUpdates,
        }),
      });
      const payload = (await res.json()) as {
        ok: boolean;
        data?: { brief: typeof brief; pages: typeof initialPages };
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok && payload.data) {
        setPages(toEditable(payload.data.pages));
        setLatestBrief(payload.data.brief);
        setIsSavingDraft(false);
        return;
      }
      const code = payload.error?.code ?? "INTERNAL_ERROR";
      const message =
        code === "VERSION_CONFLICT"
          ? "Someone else edited this brief while you were reviewing. Refresh and try again."
          : payload.error?.message ?? `Save failed (HTTP ${res.status}).`;
      setErrorMessage(message);
      setIsSavingDraft(false);
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setIsSavingDraft(false);
    }
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
          expected_version_lock: latestBrief.version_lock,
          page_hash: hash,
          brand_voice: voiceValue,
          design_direction: directionValue,
          text_model: textModel,
          visual_model: visualModel,
        }),
      });
      const payload = (await res.json()) as {
        ok: boolean;
        data?: unknown;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        // RS-3: skip the intermediate "committed" panel — the operator
        // wants to start the run, not see another OK screen. The /review
        // route also redirects committed briefs to /run server-side, so
        // a back-button + reload still lands on the run surface.
        router.push(`/admin/sites/${siteId}/briefs/${brief.id}/run`);
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
        <Alert variant="destructive" title="We couldn't parse this brief.">
          <p>{failureMessage}</p>
          <p className="mt-2">
            <a
              href={`/admin/sites/${siteId}`}
              className="underline transition-smooth hover:no-underline"
            >
              Back to site overview
            </a>{" "}
            to upload a new version.
          </p>
        </Alert>
      )}

      {warnings.length > 0 && !isFailed && (
        <Alert variant="warning" title="Parser warnings">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((w: { code: string; detail?: string }, i: number) => (
              <li key={i}>
                <code className="text-sm">{w.code}</code>
                {w.detail ? <>: {w.detail}</> : null}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}

      {(brief.status === "parsed" || brief.status === "committed") && (
        <section aria-labelledby="voice-direction-heading" className="rounded-lg border p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 id="voice-direction-heading" className="text-base font-semibold">
                Brand voice &amp; design direction
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasSiteDefault && !voiceOverrideOpen
                  ? "Inheriting from site defaults. Expand to customize for this brief."
                  : hasSiteDefault
                    ? "Override values for this brief only. The site defaults below stay unchanged."
                    : "These guide every page the generator produces. Set once on Site Settings to inherit on every brief."}
              </p>
            </div>
            {hasSiteDefault && !isReadOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVoiceOverrideOpen((v) => !v)}
                aria-expanded={voiceOverrideOpen}
                aria-controls="voice-direction-fields"
              >
                {voiceOverrideOpen ? "Use site defaults" : "Customize for this brief"}
              </Button>
            )}
          </div>
          {hasSiteDefault && !voiceOverrideOpen && (
            <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
              {siteBrandVoiceDefault && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Brand voice (site default)
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {siteBrandVoiceDefault}
                  </p>
                </div>
              )}
              {siteDesignDirectionDefault && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Design direction (site default)
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {siteDesignDirectionDefault}
                  </p>
                </div>
              )}
            </div>
          )}
          <div
            id="voice-direction-fields"
            hidden={hasSiteDefault && !voiceOverrideOpen}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            <div>
              <label
                htmlFor="brand-voice-input"
                className="block text-sm font-medium text-muted-foreground"
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
                className="mt-1 text-sm text-muted-foreground"
              >
                How every page should sound. 4 KB max.
              </p>
            </div>
            <div>
              <label
                htmlFor="design-direction-input"
                className="block text-sm font-medium text-muted-foreground"
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
                className="mt-1 text-sm text-muted-foreground"
              >
                Constrains the anchor cycle on page 1, then re-used verbatim
                for pages 2..N. 4 KB max.
              </p>
            </div>
          </div>
        </section>
      )}

      {(brief.status === "parsed" || brief.status === "committed") && (
        <section aria-labelledby="model-tier-heading" className="rounded-lg border p-4">
          <div className="mb-3">
            <h2 id="model-tier-heading" className="text-base font-semibold">
              Model tier
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick the Claude model for text generation and for the visual
              review critique. Sonnet is the default for both — Opus is
              reserved for complex-judgment briefs. See the cost estimate on
              the run surface before starting.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="text-model-select"
                className="block text-sm font-medium text-muted-foreground"
              >
                Text model (draft / critique / revise passes)
              </label>
              <select
                id="text-model-select"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm disabled:opacity-50"
                value={textModel}
                onChange={(e) => setTextModel(e.target.value)}
                disabled={isReadOnly}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-muted-foreground">
                {MODEL_OPTIONS.find((o) => o.value === textModel)?.hint ?? ""}
              </p>
            </div>
            <div>
              <label
                htmlFor="visual-model-select"
                className="block text-sm font-medium text-muted-foreground"
              >
                Visual critique model
              </label>
              <select
                id="visual-model-select"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm disabled:opacity-50"
                value={visualModel}
                onChange={(e) => setVisualModel(e.target.value)}
                disabled={isReadOnly}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-muted-foreground">
                {MODEL_OPTIONS.find((o) => o.value === visualModel)?.hint ?? ""}
              </p>
            </div>
          </div>
        </section>
      )}

      {(brief.status === "parsed" || brief.status === "committed") && (
        <section aria-label="Page list">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Page list</h2>
            <p className="text-sm text-muted-foreground">
              {sortedPages.length} page{sortedPages.length === 1 ? "" : "s"}
            </p>
          </div>

          <ol className="space-y-4">
            {sortedPages.map((p) => (
              <li key={p.localKey} className="rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 shrink-0 text-center text-sm text-muted-foreground pt-2">
                    {p.ordinal + 1}
                  </div>

                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground">
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
                      {p.mode === "import" ? (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-sm font-medium text-blue-900">
                          Import (mode locked)
                        </span>
                      ) : (
                        <ModePill
                          mode={p.mode}
                          disabled={isReadOnly}
                          onToggle={() =>
                            setPage(p.localKey, {
                              mode: p.mode === "full_text" ? "short_brief" : "full_text",
                            })
                          }
                        />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {p.word_count} word{p.word_count === 1 ? "" : "s"}
                      </span>
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                        Show source excerpt
                      </summary>
                      <Textarea
                        className="mt-2 text-sm"
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
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || sortedPages.length === 0}
          >
            {isSavingDraft ? "Saving…" : "Save draft"}
          </Button>
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

      {/* RS-3: removed the post-commit panel. Successful commit pushes
          the operator straight to /run; the /review route redirects
          server-side if the operator returns to the URL with status
          === "committed". The committed state still exists in the DB —
          just no UI surface for it on this page. */}

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
  // Folded to the A-4 primitive — kept as a thin local wrapper because
  // the component file references `<StatusPill status={...} />` in a
  // dozen places and the pattern reads more naturally than spelling
  // out briefStatusKind() at every call site.
  return <UIStatusPill kind={briefStatusKind(status)} />;
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
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
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
