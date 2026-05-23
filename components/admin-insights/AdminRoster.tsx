"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AdminClientRow } from "@/lib/insights/admin-dashboard";
import { AdminClientRowItem } from "./AdminClientRowItem";

interface AdminRosterProps {
  roster: AdminClientRow[];
}

const PAGE_SIZE = 20;

export function AdminRoster({ roster }: AdminRosterProps) {
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<"all" | "green" | "amber" | "red">("all");
  const [page, setPage] = useState(0);

  const filtered = roster.filter((r) => {
    const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase());
    const matchesHealth = healthFilter === "all" || r.healthStatus === healthFilter;
    return matchesSearch && matchesHealth;
  });

  const total = filtered.length;
  const page_rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card className="border-b2" data-testid="admin-roster">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-section-title text-tx-primary">Client roster</h2>
          <div className="flex items-center gap-2">
            <select
              className="text-sm border border-b2 rounded-md px-2 py-1 bg-transparent text-tx-primary"
              value={healthFilter}
              onChange={(e) => {
                setHealthFilter(e.target.value as typeof healthFilter);
                setPage(0);
              }}
              aria-label="Filter by health"
            >
              <option value="all">Health: all</option>
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </select>
            <input
              type="search"
              placeholder="Search clients…"
              className="text-sm border border-b2 rounded-md px-3 py-1 bg-transparent text-tx-primary placeholder:text-tx-muted"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              aria-label="Search clients"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Header row */}
        <div className="grid grid-cols-[1fr_120px_120px_100px_80px_auto] gap-4 pb-2 border-b border-b2 text-sm text-tx-muted uppercase tracking-wide">
          <div>Client</div>
          <div>Last post</div>
          <div>30d trend</div>
          <div>Health</div>
          <div>Recs</div>
          <div>Action</div>
        </div>
        {page_rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-tx-muted">No clients match the current filter.</div>
        ) : (
          page_rows.map((row) => <AdminClientRowItem key={row.companyId} row={row} />)
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-3 text-sm text-tx-muted">
            <span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              {page > 0 && (
                <button onClick={() => setPage(page - 1)} className="hover:text-tx-primary">
                  ← Prev
                </button>
              )}
              {(page + 1) * PAGE_SIZE < total && (
                <button onClick={() => setPage(page + 1)} className="hover:text-tx-primary">
                  Next →
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
