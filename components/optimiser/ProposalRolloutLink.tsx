import Link from "next/link";

import type { RolloutRow } from "@/lib/optimiser/staged-rollout/read";

// Phase 1.5 follow-up — applied-proposal → rollout link on the
// proposal review screen. Renders a one-line state badge linking to
// the page detail view (where StagedRolloutBanner has the full
// breakdown). Only shows when a rollout exists for the proposal.

const STATE_TONE: Record<string, string> = {
  live: "border-info-border bg-info-bg text-info-fg",
  promoted: "border-[--color-success-border] bg-[--color-success-bg] text-[--color-success-fg]",
  manually_promoted: "border-[--color-success-border] bg-[--color-success-bg] text-[--color-success-fg]",
  auto_reverted: "border-red-200 bg-red-50 text-red-900",
  failed: "border-warning-border bg-warning-bg text-warning-fg",
};

const STATE_LABEL: Record<string, string> = {
  live: "rolling out",
  promoted: "promoted",
  manually_promoted: "manually promoted",
  auto_reverted: "auto-reverted",
  failed: "monitor failed",
};

export function ProposalRolloutLink({
  rollout,
  landingPageId,
}: {
  rollout: RolloutRow | null;
  landingPageId: string | null;
}) {
  if (!rollout || !landingPageId) return null;
  const tone = STATE_TONE[rollout.current_state] ?? STATE_TONE.live;
  const label = STATE_LABEL[rollout.current_state] ?? rollout.current_state;

  return (
    <section
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${tone}`}
    >
      <div>
        <p className="font-medium">Staged rollout: {label}</p>
        <p className="text-sm opacity-80">
          {rollout.traffic_split_percent}% traffic · started{" "}
          {new Date(rollout.started_at).toLocaleString()}
          {rollout.end_reason && (
            <>
              {" · "}
              {rollout.end_reason}
            </>
          )}
        </p>
      </div>
      <Link
        href={`/optimiser/pages/${landingPageId}`}
        className="text-sm font-medium underline-offset-4 hover:underline"
      >
        View on page →
      </Link>
    </section>
  );
}
