"use client";

import React, { useState } from "react";

import type { ServiceHealthEvent } from "@/lib/platform/service-health/types";

const SEVERITY_BADGE: Record<string, string> = {
  info: "bg-info-bg text-info-fg",
  warning: "bg-warning-bg text-warning-fg",
  critical: "bg-danger-bg text-danger-fg",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  service_5xx: "5xx",
  connection_failure: "Connection failure",
  auth_failure: "Auth failure",
  billing_failure: "Billing failure",
  rate_limit: "Rate limit",
  webhook_auth_failure: "Webhook auth failure",
  cron_stale: "Cron stale",
  recovered: "Recovered",
  manual_flag: "Manual flag",
};

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface Props {
  initialEvents: ServiceHealthEvent[];
}

export function EventTimeline({ initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  async function handleResolve(id: string) {
    setResolving(id);
    try {
      const res = await fetch(`/api/admin/service-health/events/${id}/resolve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, resolved_at: new Date().toISOString() } : e,
        ),
      );
    } finally {
      setResolving(null);
    }
  }

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
        No events in the last 30 days.
      </div>
    );
  }

  return (
    <div
      data-testid="event-timeline"
      className="overflow-x-auto rounded-md border"
    >
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Service</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Sev</th>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const isExpanded = expandedId === ev.id;
            const hasDetails =
              ev.details && Object.keys(ev.details).length > 0;

            return (
              <React.Fragment key={ev.id}>
                <tr
                  className="border-b last:border-b-0 hover:bg-muted/30"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatTs(ev.last_seen_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{ev.service_name}</span>
                    {ev.operation && (
                      <div className="text-xs text-muted-foreground">
                        {ev.operation}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE[ev.severity] ?? ""}`}
                    >
                      {ev.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ev.occurrence_count}
                  </td>
                  <td className="px-3 py-2">
                    {ev.resolved_at ? (
                      <span className="text-xs text-green-600">Resolved</span>
                    ) : (
                      <span className="text-xs text-yellow-600">Open</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {hasDetails && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : ev.id)
                          }
                        >
                          {isExpanded ? "Hide" : "Details"}
                        </button>
                      )}
                      {!ev.resolved_at && ev.event_type !== "recovered" && (
                        <button
                          type="button"
                          disabled={resolving === ev.id}
                          data-testid={`resolve-${ev.id}`}
                          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                          onClick={() => handleResolve(ev.id)}
                        >
                          {resolving === ev.id ? "…" : "Resolve"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {isExpanded && hasDetails && (
                  <tr className="border-b bg-muted/20 last:border-b-0">
                    <td colSpan={7} className="px-4 py-2">
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {JSON.stringify(ev.details, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
