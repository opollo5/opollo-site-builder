"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Phase 2 Slice 18 — A/B variant creation affordance on the proposal
// review page. Visible only when the proposal is approved/applied and
// no test currently exists for the page. The parent server component
// gates visibility; this component is the action affordance.

export function CreateVariantButton({
  proposalId,
  hostingMode,
}: {
  proposalId: string;
  /** Variants only spin up for hosted modes; client_slice mode skips
   * to direct deployment. The button stays hidden upstream when this
   * is 'client_slice'. */
  hostingMode: "opollo_subdomain" | "opollo_cname" | "client_slice";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [split, setSplit] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "ok" | "err";
  } | null>(null);

  if (hostingMode === "client_slice") return null;

  async function submit() {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/optimiser/proposals/${proposalId}/create-variant`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ traffic_split_percent: split }),
        },
      );
      const json = await res.json();
      if (!json.ok) {
        setStatus({
          message: json.error?.message ?? "Variant creation failed.",
          tone: "err",
        });
        return;
      }
      setStatus({
        message: `A/B test queued. Variant A + B briefs submitted; activation runs when both variants finish generating.`,
        tone: "ok",
      });
      setTimeout(() => router.refresh(), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <header>
        <h3 className="text-sm font-semibold">A/B test (Phase 2)</h3>
        <p className="text-xs text-muted-foreground">
          Generate a structurally distinct alternative and route a slice of traffic to it.
          Winner detection runs hourly via the §6 feature 8 Bayesian monitor.
        </p>
      </header>
      {!open ? (
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Create A/B variant
        </Button>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Traffic split: B receives{" "}
            <span className="font-mono">{split}%</span>{" "}
            <span className="text-muted-foreground">(A gets the remainder)</span>
          </label>
          <Input
            type="range"
            min={5}
            max={95}
            step={5}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={submit} disabled={submitting}>
              {submitting ? "Generating…" : `Confirm ${split}/${100 - split} A/B`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {status && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            status.tone === "err"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
