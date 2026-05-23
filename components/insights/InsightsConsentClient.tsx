"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

interface SuppressedRec {
  id: string;
  recommendation_type: string;
  headline: string;
  platform: string;
  generated_at: string;
}

interface Props {
  companyId: string;
  crossClientLearningConsent: boolean;
  competitorTrackingConsent: boolean;
  consentedAt: string | null;
  msaVersion: string | null;
  suppressedRecommendations: SuppressedRec[];
}

export function InsightsConsentClient({
  companyId,
  crossClientLearningConsent,
  competitorTrackingConsent,
  consentedAt,
  msaVersion,
  suppressedRecommendations,
}: Props) {
  const [crossClient, setCrossClient] = useState(crossClientLearningConsent);
  const [competitor, setCompetitor] = useState(competitorTrackingConsent);
  const [suppressed, setSuppressed] = useState(suppressedRecommendations);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function updateConsent(updates: {
    cross_client_learning_consent?: boolean;
    competitor_tracking_consent?: boolean;
  }) {
    setError(null);
    startSaving(async () => {
      try {
        const res = await fetch("/api/insights/consent", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_id: companyId, ...updates }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error?.message ?? "Failed to save. Please try again.");
        }
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  async function reenableRecommendation(recId: string) {
    try {
      const res = await fetch(
        `/api/insights/recommendations/${recId}/dismiss?company_id=${encodeURIComponent(companyId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setSuppressed((prev) => prev.filter((r) => r.id !== recId));
      }
    } catch {
      // best-effort
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-[var(--rd-2)] bg-[var(--rd-1)] px-4 py-3 text-sm text-[var(--rd-3)]">
          {error}
        </p>
      )}

      <div className="space-y-4">
        <ConsentToggle
          id="cross-client"
          label="Cross-client learning"
          description="Allow Opollo to include your anonymised engagement data in aggregate pattern analysis. No post content is shared."
          checked={crossClient}
          disabled={saving}
          onCheckedChange={(v) => {
            setCrossClient(v);
            void updateConsent({ cross_client_learning_consent: v });
          }}
        />
        <ConsentToggle
          id="competitor-tracking"
          label="Competitor tracking"
          description="Allow Opollo to collect public competitor content for your gap analysis dashboard."
          checked={competitor}
          disabled={saving}
          onCheckedChange={(v) => {
            setCompetitor(v);
            void updateConsent({ competitor_tracking_consent: v });
          }}
        />
      </div>

      {(consentedAt ?? msaVersion) && (
        <div className="border-t border-[var(--b2)] pt-4 text-sm text-[var(--tx-muted)]">
          {msaVersion && <p>MSA version: {msaVersion}</p>}
          {consentedAt && (
            <p>Last updated: {new Date(consentedAt).toLocaleDateString()}</p>
          )}
        </div>
      )}

      {suppressed.length > 0 && (
        <div className="space-y-3 border-t border-[var(--b2)] pt-6">
          <h3 className="text-sm font-medium text-[var(--tx-primary)]">
            Suppressed recommendations
          </h3>
          <p className="text-sm text-[var(--tx-muted)]">
            These recommendation types have been dismissed enough times to be suppressed. Re-enable them to see them again.
          </p>
          <ul className="space-y-2">
            {suppressed.map((rec) => (
              <li
                key={rec.id}
                className="flex items-center justify-between gap-4 rounded-md border border-[var(--b2)] bg-[var(--b1)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--tx-primary)]">
                    {rec.headline}
                  </p>
                  <p className="text-sm text-[var(--tx-muted)]">
                    {rec.platform} · {rec.recommendation_type}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void reenableRecommendation(rec.id)}
                >
                  Re-enable
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConsentToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-md border border-[var(--b2)] px-4 py-4">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium text-[var(--tx-primary)]"
        >
          {label}
        </label>
        <p className="mt-0.5 text-sm text-[var(--tx-muted)]">{description}</p>
      </div>
    </div>
  );
}
