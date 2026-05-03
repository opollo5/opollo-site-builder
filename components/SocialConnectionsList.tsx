"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  type SocialConnection,
} from "@/lib/platform/social/connections/types";

// ---------------------------------------------------------------------------
// S1-12 — connections roster for /company/social/connections.
//
// Reads-only for V1. Reconnect button is a stub: clicking it surfaces
// a toast that the OAuth flow lands in S1-13. Admin-only — viewers and
// editors see the roster but can't initiate reconnects.
// ---------------------------------------------------------------------------

type Props = {
  connections: SocialConnection[];
  // Admin-or-Opollo-staff. Drives the Reconnect button visibility.
  canManage: boolean;
};

export function SocialConnectionsList({ connections, canManage }: Props) {
  const [stubbed, setStubbed] = useState<string | null>(null);

  if (connections.length === 0) {
    return (
      <div
        className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
        data-testid="connections-empty"
      >
        No social connections yet. {canManage
          ? "The Connect flow will land in a follow-up slice (S1-13)."
          : "Ask an admin to connect your team's social accounts."}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border bg-card"
      data-testid="connections-table"
    >
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Platform</th>
            <th className="px-4 py-2 font-medium">Account</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Connected</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr
              key={c.id}
              className="border-b last:border-b-0 hover:bg-muted/20"
              data-testid={`connection-row-${c.id}`}
            >
              <td className="px-4 py-3 font-medium">
                {PLATFORM_LABEL[c.platform] ?? c.platform}
              </td>
              <td className="px-4 py-3">
                <div>
                  {c.display_name ?? (
                    <span className="text-muted-foreground">
                      {c.bundle_social_account_id}
                    </span>
                  )}
                </div>
                {c.last_error ? (
                  <div
                    className="mt-1 text-sm text-rose-700"
                    data-testid={`connection-error-${c.id}`}
                  >
                    {c.last_error}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_PILL[c.status]}`}
                  data-testid={`connection-status-${c.id}`}
                >
                  {STATUS_LABEL[c.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                {new Date(c.connected_at).toLocaleString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-4 py-3 text-right">
                {canManage &&
                (c.status === "auth_required" ||
                  c.status === "disconnected") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setStubbed(
                        `Reconnect for ${PLATFORM_LABEL[c.platform]} lands in the next slice (S1-13 — bundle.social OAuth).`,
                      )
                    }
                    data-testid={`connection-reconnect-${c.id}`}
                  >
                    Reconnect
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {stubbed ? (
        <div
          className="border-t bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
          data-testid="reconnect-stub-toast"
        >
          {stubbed}
        </div>
      ) : null}
    </div>
  );
}
