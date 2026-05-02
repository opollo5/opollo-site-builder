"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

// Phase 2 Slice 21 — toggle for assisted approval mode on the client
// settings page. Admin-only; the API enforces role gate too.

export function AssistedApprovalToggle({
  clientId,
  enabled,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  isAdmin: boolean;
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
        `/api/optimiser/clients/${clientId}/assisted-approval`,
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
        message: json.data.assisted_approval_enabled
          ? "Assisted approval enabled. Low-risk proposals will auto-approve after 48h."
          : "Assisted approval disabled. All proposals require manual approval.",
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
          {enabled ? "enabled" : "disabled"}
        </strong>
      </p>
      <p className="text-sm text-muted-foreground">
        When enabled, proposals with{" "}
        <code className="font-mono text-sm">risk_level=low</code> AND{" "}
        <code className="font-mono text-sm">effort_bucket=1</code> auto-approve after 48 hours of being unreviewed. Staff get an email notification when auto-approval fires.
      </p>
      <p className="text-sm text-muted-foreground">
        High-risk proposals always require manual approval, regardless of this setting. Enforced at the API level, not just UI.
      </p>
      {isAdmin ? (
        <Button
          type="button"
          onClick={toggle}
          disabled={submitting}
          variant={enabled ? "outline" : "default"}
        >
          {submitting ? "Saving…" : enabled ? "Disable assisted approval" : "Enable assisted approval"}
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
