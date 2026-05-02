"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RepromptForm } from "@/components/optimiser/RepromptForm";

export type ProposalReviewProps = {
  proposal: {
    id: string;
    headline: string;
    problem_summary: string | null;
    risk_level: string;
    priority_score: number;
    confidence_score: number;
    confidence_sample: number | null;
    confidence_freshness: number | null;
    confidence_stability: number | null;
    confidence_signal: number | null;
    expected_impact_min_pp: number | null;
    expected_impact_max_pp: number | null;
    effort_bucket: number;
    expires_at: string | null;
    triggering_playbook_id: string | null;
    change_set: Record<string, unknown>;
    before_snapshot: Record<string, unknown>;
    current_performance: Record<string, unknown>;
  };
  evidence: Array<{
    id: string;
    evidence_type: string;
    label: string | null;
    payload: Record<string, unknown>;
  }>;
  pageUrl: string | null;
};

const REJECTION_REASONS = [
  { code: "not_aligned_brand", label: "Not aligned with brand" },
  { code: "offer_change_not_approved", label: "Offer change not approved" },
  { code: "bad_timing", label: "Bad timing (revisit later)" },
  { code: "design_conflict", label: "Design conflict" },
  { code: "other", label: "Other" },
] as const;

export function ProposalReview({
  proposal,
  evidence,
  pageUrl,
}: ProposalReviewProps) {
  const router = useRouter();
  const [reprompt, setReprompt] = useState("");
  const [rejectReason, setRejectReason] =
    useState<(typeof REJECTION_REASONS)[number]["code"]>("not_aligned_brand");
  const [rejectText, setRejectText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ message: string; tone: "ok" | "err" | "warn" } | null>(null);

  async function approve() {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/optimiser/proposals/${proposal.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pre_build_reprompt: reprompt || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Approved.", tone: "ok" });
        router.push("/optimiser/proposals");
        router.refresh();
      } else if (json.error?.code === "GUARDRAIL_FAILED") {
        setStatus({
          message: `Guardrail blocked: ${json.error.guardrail?.failures?.join("; ") ?? json.error.message}`,
          tone: "err",
        });
      } else if (json.error?.code === "EXPIRED") {
        setStatus({
          message: "Proposal expired. Generate a fresh one against current data.",
          tone: "warn",
        });
      } else {
        setStatus({
          message: json.error?.message ?? "Approve failed.",
          tone: "err",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/optimiser/proposals/${proposal.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason_code: rejectReason,
          reason_text: rejectText || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const suppressed = json.data?.suppressed_now;
        setStatus({
          message: suppressed
            ? `Rejected. Same reason ×3 — playbook suppressed for this client.`
            : "Rejected.",
          tone: suppressed ? "warn" : "ok",
        });
        router.push("/optimiser/proposals");
        router.refresh();
      } else {
        setStatus({
          message: json.error?.message ?? "Reject failed.",
          tone: "err",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const cs = proposal.change_set as { fix_template?: string };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{proposal.headline}</h1>
              {pageUrl && (
                <p className="font-mono text-sm text-muted-foreground">{pageUrl}</p>
              )}
            </div>
            <RiskPill risk={proposal.risk_level} />
          </div>
          <p className="text-sm text-muted-foreground">{proposal.problem_summary}</p>
        </header>

        <Section title="Suggested change">
          <div className="rounded-md border border-border bg-card p-4 text-sm whitespace-pre-wrap">
            {cs.fix_template ?? "(no fix template — see playbook config)"}
          </div>
        </Section>

        <Section title="Evidence">
          <ul className="space-y-2">
            {evidence.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="font-medium">
                  {e.label ?? e.evidence_type}
                </div>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-sm">
{JSON.stringify(e.payload, null, 2)}
                </pre>
              </li>
            ))}
            {evidence.length === 0 && (
              <li className="text-sm text-muted-foreground">No evidence rows.</li>
            )}
          </ul>
        </Section>

        <Section title="Current performance">
          <pre className="max-h-60 overflow-auto rounded-md border border-border bg-card p-4 text-sm">
{JSON.stringify(proposal.current_performance, null, 2)}
          </pre>
        </Section>

        <Section title="Pre-build reprompt (optional)">
          <RepromptForm value={reprompt} onChange={setReprompt} />
          <p className="mt-1 text-sm text-muted-foreground">
            Appended to the change set on approve. Phase 1.5 forwards this into the Site Builder brief.
          </p>
        </Section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Priority</h2>
          <div className="space-y-1 text-sm">
            <Row label="Priority" value={proposal.priority_score.toFixed(2)} />
            <Row
              label="Confidence"
              value={`${(proposal.confidence_score * 100).toFixed(0)}%`}
            />
            <SubRow label="sample" value={fmt(proposal.confidence_sample)} />
            <SubRow label="freshness" value={fmt(proposal.confidence_freshness)} />
            <SubRow label="stability" value={fmt(proposal.confidence_stability)} />
            <SubRow label="signal" value={fmt(proposal.confidence_signal)} />
            <Row label="Effort" value={String(proposal.effort_bucket)} />
            {proposal.expected_impact_min_pp != null &&
              proposal.expected_impact_max_pp != null && (
                <Row
                  label="Expected uplift"
                  value={`+${proposal.expected_impact_min_pp.toFixed(1)}–${proposal.expected_impact_max_pp.toFixed(1)}pp`}
                />
              )}
            {proposal.expires_at && (
              <Row
                label="Expires"
                value={new Date(proposal.expires_at).toLocaleString()}
              />
            )}
            {proposal.triggering_playbook_id && (
              <Row label="Playbook" value={proposal.triggering_playbook_id} />
            )}
          </div>
        </div>

        {status && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              status.tone === "err"
                ? "border-red-200 bg-red-50 text-red-900"
                : status.tone === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {status.message}
          </div>
        )}

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Approve</h2>
          <Button
            type="button"
            disabled={submitting}
            onClick={approve}
            className="w-full"
          >
            {submitting ? "Submitting…" : "Approve all"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Phase 1: approval marks the proposal as <code>approved</code>. Brief submission to the Site Builder generation engine lands in Phase 1.5.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Reject</h2>
          <select
            value={rejectReason}
            onChange={(e) =>
              setRejectReason(
                e.target.value as (typeof REJECTION_REASONS)[number]["code"],
              )
            }
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {REJECTION_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <Textarea
            value={rejectText}
            onChange={(e) => setRejectText(e.target.value)}
            rows={2}
            placeholder="Optional context"
          />
          <Button
            type="button"
            disabled={submitting}
            onClick={reject}
            variant="outline"
            className="w-full"
          >
            {submitting ? "Submitting…" : "Reject"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Per §11.1: 3× the same reason (excluding &quot;Bad timing&quot;) suppresses the playbook for this client.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function SubRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between pl-4 text-sm">
      <span className="text-muted-foreground">· {label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function RiskPill({ risk }: { risk: string }) {
  const cls =
    risk === "high"
      ? "bg-red-100 text-red-900 border-red-200"
      : risk === "medium"
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : "bg-emerald-100 text-emerald-900 border-emerald-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium ${cls}`}
    >
      {risk} risk
    </span>
  );
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}
