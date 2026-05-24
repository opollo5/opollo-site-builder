"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AdminClientRow, CompareDataPoint } from "@/lib/insights/admin-dashboard";

interface ClientCompareTableProps {
  roster: AdminClientRow[];
  selectedIds: string[];
  compareData: CompareDataPoint[];
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function ClientCompareTable({
  roster,
  selectedIds,
  compareData,
}: ClientCompareTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < 10) {
      next.add(id);
    }
    setSelected(next);
  }

  function applySelection() {
    const params = new URLSearchParams(searchParams.toString());
    if (selected.size > 0) {
      params.set("ids", Array.from(selected).join(","));
    } else {
      params.delete("ids");
    }
    router.push(`/admin/insights/compare?${params.toString()}`);
  }

  return (
    <Card className="border-b2" data-testid="client-compare-table">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-section-title text-tx-primary">Select clients to compare</h2>
          <Button size="sm" onClick={applySelection} disabled={selected.size === 0}>
            Compare {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {roster.map((r) => {
            const point = compareData.find((d) => d.companyId === r.companyId);
            return (
              <label
                key={r.companyId}
                className="flex items-center gap-3 py-2 border-b border-b1 last:border-0 cursor-pointer hover:bg-m1 rounded px-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.companyId)}
                  onChange={() => toggle(r.companyId)}
                  className="h-4 w-4"
                />
                <span className="flex-1 font-medium text-tx-primary">{r.name}</span>
                {point && (
                  <span className="text-sm text-tx-muted tabular-nums">
                    {fmt(point.avgEngagementRate30d)} · {point.postCount30d} posts
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
