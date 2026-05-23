"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";

export interface Competitor {
  id: string;
  platform: string;
  competitor_handle: string;
  competitor_display_name: string | null;
  created_at: string;
}

interface CompetitorListProps {
  competitors: Competitor[];
  companyId: string;
  onDeleted: (id: string) => void;
}

export function CompetitorList({ competitors, companyId, onDeleted }: CompetitorListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleDelete(competitorId: string) {
    setDeletingId(competitorId);
    try {
      const res = await fetch(
        `/api/admin/insights/clients/${companyId}/competitors/${competitorId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error?.message ?? "Failed to remove competitor");
        return;
      }
      startTransition(() => onDeleted(competitorId));
    } finally {
      setDeletingId(null);
    }
  }

  if (competitors.length === 0) {
    return (
      <p className="text-tx-muted text-sm py-6 text-center">
        No competitors tracked yet. Add one to start monitoring.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-b2" data-testid="competitor-list">
      {competitors.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-tx-primary truncate">
              {c.competitor_display_name ?? c.competitor_handle}
            </p>
            <p className="text-sm text-tx-muted">@{c.competitor_handle}</p>
          </div>
          <Pill variant="neutral">{c.platform}</Pill>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${c.competitor_handle}`}
            disabled={deletingId === c.id}
            onClick={() => handleDelete(c.id)}
            data-testid={`remove-competitor-${c.id}`}
          >
            <Trash2Icon size={20} className="text-rd-500" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
