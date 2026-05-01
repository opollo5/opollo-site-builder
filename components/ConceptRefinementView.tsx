"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConceptResult,
} from "@/components/DesignDirectionInputs";

// ---------------------------------------------------------------------------
// ConceptRefinementView — PR 7 of DESIGN-DISCOVERY.
//
// Operator clicks "Select this direction" → this view replaces the
// 3-up grid. Shows the selected concept full-width with the previous
// version (pre-refinement) ghosted at 40% opacity beside it once a
// refinement has happened. Below: feedback textarea + Refine + Approve
// + Back-to-cards CTAs.
//
// Refinement loop: 10-cap. Soft warning at 7. After approval,
// refinement locks; the only action is "Reset and start over" which
// clears the approved concept and returns Step 1 to its 3-up grid.
// ---------------------------------------------------------------------------

interface Props {
  siteId: string;
  brief: BriefForRefinement;
  initialConcept: ConceptResult;
  onCancel: () => void;
  onApproved: () => void;
}

interface BriefForRefinement {
  industry: string;
  reference_url: string | null;
  existing_site_url: string | null;
  description: string | null;
  edited_understanding: string | null;
  refinement_notes: string[];
  extracted: ConceptResult["design_tokens"] extends infer T
    ? unknown
    : unknown;
}

const REFINE_CAP = 10;
const REFINE_WARN_AT = 7;

export function ConceptRefinementView({
  siteId,
  brief,
  initialConcept,
  onCancel,
  onApproved,
}: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<ConceptResult>(initialConcept);
  const [previous, setPrevious] = useState<ConceptResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [refinementNotes, setRefinementNotes] = useState<string[]>(
    brief.refinement_notes ?? [],
  );
  const [refining, setRefining] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refinementsUsed = refinementNotes.length;
  const refinementsRemaining = Math.max(0, REFINE_CAP - refinementsUsed);
  const atCap = refinementsUsed >= REFINE_CAP;
  const showWarning = refinementsUsed >= REFINE_WARN_AT && !atCap;

  async function onRefine() {
    if (atCap) return;
    if (!feedback.trim()) {
      toast.error("Add a refinement note first.");
      return;
    }
    setRefining(true);
    setError(null);
    const nextNotes = [...refinementNotes, feedback.trim()];
    try {
      const res = await fetch(
        `/api/admin/sites/${siteId}/setup/refine-concept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: { ...brief, refinement_notes: nextNotes },
            direction: current.direction,
          }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ConceptResult }
        | { ok: false; error: { code?: string; message: string } }
        | null;
      if (!payload?.ok) {
        setError(
          payload?.ok === false ? payload.error.message : "Refinement failed.",
        );
        // Server-side cap (DESIGN-DISCOVERY-FOLLOWUP PR 3): a 429
        // means the operator has burned their 10-call budget on the
        // server, even if local state thinks they have remaining.
        // Snap the local counter forward so the Refine button locks.
        if (
          res.status === 429 ||
          (payload?.ok === false && payload.error.code === "LIMIT_REACHED")
        ) {
          setRefinementNotes(
            new Array(REFINE_CAP).fill("").map((_, i) =>
              refinementNotes[i] ?? "(server-side cap)",
            ),
          );
        }
        setRefining(false);
        return;
      }
      setPrevious(current);
      setCurrent(payload.data);
      setRefinementNotes(nextNotes);
      setFeedback("");
      setRefining(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setRefining(false);
    }
  }

  async function onApprove() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/sites/${siteId}/setup/approve-design`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: { ...brief, refinement_notes: refinementNotes },
            concept: {
              homepage_html: current.homepage_html,
              inner_page_html: current.inner_page_html,
              design_tokens: current.design_tokens,
              rationale: current.rationale,
              direction: current.direction,
            },
          }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        setError(
          payload?.ok === false ? payload.error.message : "Approval failed.",
        );
        setApproving(false);
        return;
      }
      toast.success("Design direction approved.");
      router.refresh();
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setApproving(false);
    }
  }

  return (
    <section
      className="space-y-4 rounded-lg border bg-card p-4"
      data-testid="concept-refinement"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{current.label} direction</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {current.rationale}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
          data-testid="concept-refinement-back"
        >
          ← Back to all directions
        </button>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {previous ? (
          <div className="opacity-40">
            <p className="text-[10px] font-medium text-muted-foreground">
              Previous version
            </p>
            <div
              className="mt-1 h-72 overflow-hidden rounded-md border bg-muted/20"
              data-testid="concept-refinement-previous"
            >
              <iframe
                title={`${previous.label} — previous`}
                srcDoc={previous.homepage_html}
                sandbox=""
                className="block h-full w-full"
              />
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            <p className="text-[10px] font-medium">Previous version</p>
            <div className="mt-1 flex h-72 items-center justify-center rounded-md border bg-muted/10">
              No prior version yet — first refinement will land here.
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] font-medium text-muted-foreground">
            Updated version
          </p>
          <div
            className="mt-1 h-72 overflow-hidden rounded-md border bg-muted/20"
            data-testid="concept-refinement-current"
          >
            <iframe
              title={`${current.label} — current`}
              srcDoc={current.homepage_html}
              sandbox=""
              className="block h-full w-full"
            />
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <label
          htmlFor="concept-refinement-feedback"
          className="block text-xs font-medium"
        >
          Refine this direction
        </label>
        <Textarea
          id="concept-refinement-feedback"
          placeholder="e.g. Make the hero copy shorter. Use a denser card grid in the Services section. Add a logo bar above the CTA."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={1500}
          rows={3}
          disabled={refining || approving || atCap}
          className="mt-1"
          data-testid="concept-refinement-feedback"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span data-testid="concept-refinement-counter">
            {refinementsUsed}/{REFINE_CAP} refinements used.
            {showWarning && (
              <span className="ml-2 text-warning">
                {refinementsRemaining} refinement{refinementsRemaining === 1 ? "" : "s"} remaining.
              </span>
            )}
            {atCap && (
              <span className="ml-2 text-destructive">
                Refinement cap reached.
              </span>
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRefine()}
            disabled={refining || approving || atCap || !feedback.trim()}
            data-testid="concept-refinement-refine"
          >
            {refining ? (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                Refining…
              </>
            ) : (
              "Refine this direction"
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
          data-testid="concept-refinement-error"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          onClick={() => void onApprove()}
          disabled={approving || refining}
          data-testid="concept-refinement-approve"
        >
          {approving ? (
            <>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Approving…
            </>
          ) : (
            <>
              <Check aria-hidden className="h-4 w-4" />
              Approve this direction
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

export function ApprovedDesignReadout({
  siteId,
  homepageHtml,
  innerPageHtml,
  toneAppliedHomepageHtml,
  tokens,
  onReset,
}: {
  siteId: string;
  homepageHtml: string | null;
  innerPageHtml: string | null;
  toneAppliedHomepageHtml?: string | null;
  tokens: Record<string, unknown> | null;
  onReset?: () => void;
}) {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const swatchKeys = ["primary", "secondary", "accent", "background", "text"];

  async function onResetClick() {
    if (!confirm("Reset and start over? This clears the approved concept.")) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/sites/${siteId}/setup/approve-design`,
        { method: "DELETE" },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        setError(
          payload?.ok === false ? payload.error.message : "Reset failed.",
        );
        setResetting(false);
        return;
      }
      toast.success("Approved concept cleared. Generate or refine again.");
      router.refresh();
      onReset?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setResetting(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-4"
      data-testid="approved-design-readout"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-success">
            Design direction approved
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This is what every page we generate will be styled around.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onResetClick()}
          disabled={resetting}
          data-testid="approved-design-reset"
        >
          {resetting ? (
            <>
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              Resetting…
            </>
          ) : (
            <>
              <RotateCcw aria-hidden className="h-3.5 w-3.5" />
              Reset and start over
            </>
          )}
        </Button>
      </div>

      {tokens && (
        <div className="flex flex-wrap items-center gap-1.5">
          {swatchKeys.map((k) => {
            const v = tokens[k];
            if (typeof v !== "string") return null;
            return (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px]"
                title={`${k}: ${v}`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border"
                  style={{ background: v }}
                  aria-hidden
                />
                <span className="font-mono uppercase">{k}</span>
              </span>
            );
          })}
        </div>
      )}

      {homepageHtml && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground">
              {toneAppliedHomepageHtml
                ? "Your design with your voice applied"
                : "Homepage"}
            </p>
            <div
              className="mt-1 h-72 overflow-hidden rounded-md border bg-muted/20"
              data-testid="approved-design-homepage-frame"
              data-tone-applied={
                toneAppliedHomepageHtml ? "true" : "false"
              }
            >
              <iframe
                title="Approved homepage"
                srcDoc={toneAppliedHomepageHtml ?? homepageHtml}
                sandbox=""
                className="block h-full w-full"
              />
            </div>
          </div>
          {innerPageHtml && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground">
                Inner page
              </p>
              <div className="mt-1 h-72 overflow-hidden rounded-md border bg-muted/20">
                <iframe
                  title="Approved inner page"
                  srcDoc={innerPageHtml}
                  sandbox=""
                  className="block h-full w-full"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}
    </section>
  );
}
