"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LandingPage } from "@/lib/optimiser/landing-pages";
import type { OptClient } from "@/lib/optimiser/clients";
import type {
  OptDataReliability,
  OptPageState,
} from "@/lib/optimiser/types";
import {
  classificationBadgeColor,
  classificationLabel,
} from "@/lib/optimiser/scoring/classify";
import type { ScoreClassification } from "@/lib/optimiser/scoring/types";

// Page browser (§9.3 + addendum §4.1).
// v1.6 adds the composite-score column + classification badge.

const STATE_PILL: Record<OptPageState, string> = {
  active: "bg-blue-100 text-blue-900 border-blue-200",
  healthy: "bg-emerald-100 text-emerald-900 border-emerald-200",
  insufficient_data: "bg-muted text-muted-foreground border-border",
  read_only_external: "bg-amber-100 text-amber-900 border-amber-200",
};

const STATE_LABEL: Record<OptPageState, string> = {
  active: "Active",
  healthy: "Healthy — no action needed",
  insufficient_data: "Gathering data",
  read_only_external: "Read-only (external)",
};

const RELIABILITY_DOT: Record<OptDataReliability, { color: string; label: string }> = {
  green: { color: "bg-emerald-500", label: "Data thresholds clear" },
  amber: { color: "bg-amber-400", label: "Some thresholds unmet — interpret with care" },
  red: { color: "bg-red-500", label: "Below thresholds — engine cannot judge" },
};

export type PageBrowserProps = {
  client: OptClient;
  pages: Array<
    LandingPage & {
      latest_alignment_score: number | null;
      conversion_rate: number;
      bounce_rate: number;
      avg_scroll_depth: number;
      sessions_window: number;
    }
  >;
};

export function PageBrowser({ client, pages }: PageBrowserProps) {
  const [filterState, setFilterState] = useState<"all" | OptPageState>("all");
  const [filterClassification, setFilterClassification] =
    useState<"all" | ScoreClassification>("all");
  const [filterReliability, setFilterReliability] =
    useState<"all" | OptDataReliability>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return pages.filter((p) => {
      if (filterState !== "all" && p.state !== filterState) return false;
      if (
        filterClassification !== "all" &&
        p.current_classification !== filterClassification
      ) {
        return false;
      }
      if (filterReliability !== "all" && p.data_reliability !== filterReliability) {
        return false;
      }
      if (search && !p.url.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [pages, filterState, filterClassification, filterReliability, search]);

  const classCounts = useMemo(() => {
    const c: Record<ScoreClassification | "total" | "uncategorised", number> = {
      total: pages.length,
      high_performer: 0,
      optimisable: 0,
      needs_attention: 0,
      uncategorised: 0,
    };
    for (const p of pages) {
      const cls = p.current_classification as ScoreClassification | null;
      if (cls && cls in c) c[cls] += 1;
      else c.uncategorised += 1;
    }
    return c;
  }, [pages]);

  const stateCounts = useMemo(() => {
    const c: Record<OptPageState | "total", number> = {
      total: pages.length,
      active: 0,
      healthy: 0,
      insufficient_data: 0,
      read_only_external: 0,
    };
    for (const p of pages) c[p.state] += 1;
    return c;
  }, [pages]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Pill onClick={() => setFilterClassification("all")} active={filterClassification === "all"}>
            All ({classCounts.total})
          </Pill>
          <Pill
            onClick={() => setFilterClassification("high_performer")}
            active={filterClassification === "high_performer"}
          >
            High performers ({classCounts.high_performer})
          </Pill>
          <Pill
            onClick={() => setFilterClassification("optimisable")}
            active={filterClassification === "optimisable"}
          >
            Optimisable ({classCounts.optimisable})
          </Pill>
          <Pill
            onClick={() => setFilterClassification("needs_attention")}
            active={filterClassification === "needs_attention"}
          >
            Needs attention ({classCounts.needs_attention})
          </Pill>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Filter by URL"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <select
            value={filterReliability}
            onChange={(e) =>
              setFilterReliability(e.target.value as "all" | OptDataReliability)
            }
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">Reliability: any</option>
            <option value="green">Green only</option>
            <option value="amber">Amber+</option>
            <option value="red">Red only</option>
          </select>
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value as "all" | OptPageState)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">State: any ({stateCounts.total})</option>
            <option value="active">Active ({stateCounts.active})</option>
            <option value="healthy">Healthy ({stateCounts.healthy})</option>
            <option value="insufficient_data">
              Gathering ({stateCounts.insufficient_data})
            </option>
            <option value="read_only_external">
              Read-only ({stateCounts.read_only_external})
            </option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Alignment</th>
              <th className="px-3 py-2 text-right">CR</th>
              <th className="px-3 py-2 text-right">Bounce</th>
              <th className="px-3 py-2 text-right">Scroll</th>
              <th className="px-3 py-2 text-right">Sessions</th>
              <th className="px-3 py-2 text-right">Spend (30d)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  No pages match the current filters.
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const dot = RELIABILITY_DOT[p.data_reliability];
              const cls = p.current_classification as ScoreClassification | null;
              const score = p.current_composite_score as number | null;
              return (
                <tr key={p.id} className="border-t border-border align-top hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <span
                      title={dot.label}
                      className={`inline-block size-2.5 rounded-full ${dot.color}`}
                      aria-label={dot.label}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/optimiser/pages/${p.id}`}
                      className="font-mono text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {p.url}
                    </Link>
                    {(p.active_technical_alerts ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(p.active_technical_alerts as string[]).map((alert) => (
                          <span
                            key={alert}
                            className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-sm text-red-900"
                          >
                            ⚠ {alert.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {score != null && cls ? (
                      <ScoreBadge score={score} classification={cls} />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium ${STATE_PILL[p.state]}`}
                    >
                      {STATE_LABEL[p.state]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.latest_alignment_score != null
                      ? p.latest_alignment_score.toFixed(0)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.conversion_rate > 0
                      ? `${(p.conversion_rate * 100).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.bounce_rate > 0
                      ? `${(p.bounce_rate * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.avg_scroll_depth > 0
                      ? `${(p.avg_scroll_depth * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{p.sessions_window}</td>
                  <td className="px-3 py-2 text-right">
                    ${(p.spend_30d_usd_cents / 100).toFixed(0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Client: <span className="font-medium">{client.name}</span> ·{" "}
        <Link
          href={`/optimiser/onboarding/${client.id}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          settings
        </Link>{" "}
        ·{" "}
        <Link
          href={`/optimiser/clients/${client.id}/settings`}
          className="text-primary underline-offset-4 hover:underline"
        >
          score weights
        </Link>
      </p>
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ScoreBadge({
  score,
  classification,
}: {
  score: number;
  classification: ScoreClassification;
}) {
  const colours = classificationBadgeColor(classification);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 ${colours.bg} ${colours.border} ${colours.text}`}
      title={classificationLabel(classification)}
    >
      <span aria-hidden className={`inline-block size-2 rounded-full ${colours.dot}`} />
      <span className="font-mono text-sm font-semibold">{score}</span>
    </span>
  );
}
