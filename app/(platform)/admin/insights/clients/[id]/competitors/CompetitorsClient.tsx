"use client";

import { useState } from "react";

import { CompetitorList, type Competitor } from "@/components/admin-insights/CompetitorList";
import { AddCompetitorDialog } from "@/components/admin-insights/AddCompetitorDialog";

interface CompetitorsClientProps {
  companyId: string;
  initialCompetitors: Competitor[];
}

export function CompetitorsClient({ companyId, initialCompetitors }: CompetitorsClientProps) {
  const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors);

  function handleAdded(competitor: Competitor) {
    setCompetitors((prev) => [competitor, ...prev]);
  }

  function handleDeleted(id: string) {
    setCompetitors((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-tx-muted">
          {competitors.length} competitor{competitors.length !== 1 ? "s" : ""} tracked
        </p>
        <AddCompetitorDialog companyId={companyId} onAdded={handleAdded} />
      </div>
      <CompetitorList
        competitors={competitors}
        companyId={companyId}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
