import Link from "next/link";

import type { RolloutRow } from "@/lib/optimiser/staged-rollout/read";

// Phase 1.5 follow-up — applied-proposal → rollout link on the
// proposal review screen. Renders a one-line state badge linking to
// the page detail view (where StagedRolloutBanner has the full
// breakdown). Only shows when a rollout exists for the proposal.

const STATE_TONE: Record<string, string> = {
  live: "border-blue-200 bg-blue-50 text-blue-900",
  promoted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  manually_promoted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  auto_reverted: "border-red-200 bg-red-50 text-red-900",
  failed: "border-amber-200 bg-amber-50 text-amber-900",
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
        <p className="text-xs opacity-80">
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
        className="text-xs font-medium underline-offset-4 hover:underline"
      >
        View on page →
      </Link>
    </section>
  );
}
