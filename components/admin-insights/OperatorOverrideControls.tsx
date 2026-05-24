"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

interface OperatorOverrideControlsProps {
  recommendationId: string;
  companyId: string;
  suppressed: boolean;
  onActionComplete?: () => void;
}

export function OperatorOverrideControls({
  recommendationId,
  companyId,
  suppressed,
  onActionComplete,
}: OperatorOverrideControlsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callApi(action: "dismiss" | "unsuppress" | "annotate", body?: Record<string, unknown>) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/insights/clients/${companyId}/${action}/${recommendationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        },
      );
      const data = await res.json();
      if (!data.ok) {
        setError(data.error?.message ?? "Action failed");
      } else {
        onActionComplete?.();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-b1 mt-2" data-testid="operator-override-controls">
      {!suppressed && (
        <Button
          variant="ghost"
          size="sm"
          className="text-sm text-tx-secondary"
          disabled={loading !== null}
          onClick={() => callApi("dismiss", { reason: "operator_admin" })}
          data-testid="dismiss-for-client-btn"
        >
          {loading === "dismiss" ? "Dismissing…" : "Dismiss for client"}
        </Button>
      )}
      {suppressed && (
        <Button
          variant="ghost"
          size="sm"
          className="text-sm text-tx-secondary"
          disabled={loading !== null}
          onClick={() => callApi("unsuppress")}
          data-testid="unsuppress-btn"
        >
          {loading === "unsuppress" ? "Un-suppressing…" : "Un-suppress"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-sm text-tx-secondary"
        disabled={loading !== null}
        onClick={() => callApi("annotate", { note: "Admin note" })}
        data-testid="add-note-btn"
      >
        {loading === "annotate" ? "Saving…" : "Add note"}
      </Button>
      {error && <span className="text-sm text-rd">{error}</span>}
    </div>
  );
}
