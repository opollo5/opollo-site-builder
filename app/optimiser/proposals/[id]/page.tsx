import { notFound } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { CreateVariantButton } from "@/components/optimiser/CreateVariantButton";
import { PastCausalDeltasPanel } from "@/components/optimiser/PastCausalDeltasPanel";
import { ProposalReview } from "@/components/optimiser/ProposalReview";
import { getClient } from "@/lib/optimiser/clients";
import { listRecentCausalDeltasForPlaybook } from "@/lib/optimiser/causal/read-deltas";
import { getProposalWithEvidence } from "@/lib/optimiser/proposals";
import { getLandingPage } from "@/lib/optimiser/landing-pages";
import { getServiceRoleClient } from "@/lib/supabase";

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
  const client = await getClient(proposal.client_id);

  // Past causal deltas for the same playbook on this client — drives
  // the §4.3 "what happened last time we did this" panel.
  const pastDeltas = proposal.triggering_playbook_id
    ? await listRecentCausalDeltasForPlaybook({
        clientId: proposal.client_id,
        playbookId: proposal.triggering_playbook_id,
        limit: 5,
      })
    : [];

  // Phase 2 Slice 18: surface "Create A/B variant" only when the
  // proposal is approved/applied AND no test currently exists for the
  // page in queued/running state.
  const supabase = getServiceRoleClient();
  const { data: existingTest } = await supabase
    .from("opt_tests")
    .select("id, status")
    .eq("landing_page_id", proposal.landing_page_id)
    .in("status", ["queued", "running"])
    .maybeSingle();
  const canCreateVariant =
    !existingTest &&
    (proposal.status === "approved" || proposal.status === "applied");

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
      <PastCausalDeltasPanel
        deltas={pastDeltas}
        playbookId={proposal.triggering_playbook_id}
      />
      {canCreateVariant && client && (
        <CreateVariantButton
          proposalId={proposal.id}
          hostingMode={
            client.hosting_mode as
              | "opollo_subdomain"
              | "opollo_cname"
              | "client_slice"
          }
        />
      )}
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
