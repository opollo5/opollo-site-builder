"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

// Phase 3 Slice 24 — toggle for cross-client learning consent on the
// client settings page. Admin-only; the API enforces the role gate too.
//
// Per spec §11.2.2 this flag gates both directions: contribution to
// the anonymised pattern library AND application of cross-client priors
// to this client's proposals. Per §11.2.4 an MSA-clause must be signed
// before the flag is flipped to true — the warning copy reminds the
// operator of that precondition. Legal sign-off is operational; we
// don't gate it in code.

export function CrossClientConsentToggle({
  clientId,
  enabled,
  isAdmin,
  patternLibraryEnabled,
}: {
  clientId: string;
  enabled: boolean;
  isAdmin: boolean;
  patternLibraryEnabled: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "ok" | "err";
  } | null>(null);

  async function toggle() {
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/optimiser/clients/${clientId}/cross-client-consent`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !enabled }),
        },
      );
      const json = await res.json();
      if (!json.ok) {
        setStatus({
          message: json.error?.message ?? "Toggle failed.",
          tone: "err",
        });
        return;
      }
      setStatus({
        message: json.data.cross_client_learning_consent
          ? "Cross-client learning enabled. Anonymised patterns will be contributed AND applied for this client."
          : "Cross-client learning disabled. This client neither contributes patterns nor receives cross-client priors.",
        tone: "ok",
      });
      setTimeout(() => router.refresh(), 800);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Status:{" "}
        <strong className={enabled ? "text-emerald-700" : "text-muted-foreground"}>
          {enabled ? "consenting" : "not consenting"}
        </strong>
      </p>
      <p className="text-sm text-muted-foreground">
        When enabled, this client both <strong>contributes</strong>{" "}
        anonymised structural patterns from their causal deltas to the
        cross-client pattern library, AND <strong>receives</strong>{" "}
        cross-client priors blended into the expected-impact range of new
        proposals. Disabling later stops both directions immediately;
        previously contributed patterns remain (anonymised, no client
        identifier stored).
      </p>
      <p className="text-sm text-muted-foreground">
        Anonymisation is structural-only — the schema has no foreign keys
        to client, page, or proposal rows. Pattern observations describe
        shapes (e.g. <em>cta_position above-fold vs below-fold</em>), not
        copy, URLs, testimonials, or pricing.
      </p>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Legal precondition (spec §11.2.4)</p>
        <p className="mt-1">
          An MSA cross-client-learning clause must be signed before flipping
          this on. The toggle does not enforce that — it is operational.
        </p>
      </div>
      {!patternLibraryEnabled && (
        <div className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
          The <code className="font-mono">OPT_PATTERN_LIBRARY_ENABLED</code>{" "}
          feature flag is currently off. Even with consent on, no
          contribution or application will happen until the flag is set.
        </div>
      )}
      {isAdmin ? (
        <Button
          type="button"
          onClick={toggle}
          disabled={submitting}
          variant={enabled ? "outline" : "default"}
        >
          {submitting
            ? "Saving…"
            : enabled
              ? "Withdraw cross-client consent"
              : "Enable cross-client learning"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only admins can toggle this setting.
        </p>
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
