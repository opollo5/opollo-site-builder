"use client";

import { SuccessMoment } from "@/components/ui/success-moment";

// Spec 08 surface — optimiser proposal applied (Tier 1).
//
// Renders at the top of /optimiser/proposals/[id] when the proposal's
// status is "applied". Per-proposal firstTimeKey so the celebration
// fires once when the operator first lands on the applied state and
// stays quiet on subsequent revisits.
//
// Lives under components/optimiser/ per the module-private rule
// (CLAUDE.md → "Module-private code under components/optimiser/").

interface Props {
  proposalId: string;
  rolloutHref?: string | null;
}

export function ProposalAppliedMoment({
  proposalId,
  rolloutHref,
}: Props) {
  return (
    <SuccessMoment
      firstTimeKey={`optimiser-applied:${proposalId}`}
      title="Proposal applied to the live page."
      firstTimeTitle="Proposal applied. The live page is updated."
      subtitle="The change is live now. Track its measured impact in the rollout panel below."
      primaryAction={
        rolloutHref
          ? { label: "View rollout", href: rolloutHref }
          : undefined
      }
    />
  );
}
