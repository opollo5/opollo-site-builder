import { notFound } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ProposalReview } from "@/components/optimiser/ProposalReview";
import { getProposalWithEvidence } from "@/lib/optimiser/proposals";
import { getLandingPage } from "@/lib/optimiser/landing-pages";

export const metadata = { title: "Optimiser · Proposal review" };
export const dynamic = "force-dynamic";

export default async function OptimiserProposalReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const { proposal, evidence } = await getProposalWithEvidence(params.id);
  if (!proposal) notFound();
  const page = await getLandingPage(proposal.landing_page_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link href="/optimiser/proposals">← All proposals</Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          Status: <code>{proposal.status}</code>
        </span>
      </div>
      <ProposalReview
        proposal={{
          id: proposal.id,
          headline: proposal.headline,
          problem_summary: proposal.problem_summary,
          risk_level: proposal.risk_level,
          priority_score: proposal.priority_score,
          confidence_score: proposal.confidence_score,
          confidence_sample: proposal.confidence_sample,
          confidence_freshness: proposal.confidence_freshness,
          confidence_stability: proposal.confidence_stability,
          confidence_signal: proposal.confidence_signal,
          expected_impact_min_pp: proposal.expected_impact_min_pp,
          expected_impact_max_pp: proposal.expected_impact_max_pp,
          effort_bucket: proposal.effort_bucket,
          expires_at: proposal.expires_at,
          triggering_playbook_id: proposal.triggering_playbook_id,
          change_set: proposal.change_set,
          before_snapshot: proposal.before_snapshot,
          current_performance: proposal.current_performance,
        }}
        evidence={evidence}
        pageUrl={page?.url ?? null}
      />
    </div>
  );
}
