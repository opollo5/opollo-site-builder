"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { formatRelativeTime } from "@/lib/utils";

// AUTH-FOUNDATION P3.3 — pending-invites table on /admin/users.

interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "user";
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
}

export function PendingInvitesTable({
  invites,
}: {
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(id: string, email: string) {
    if (!window.confirm(`Revoke pending invite for ${email}?`)) return;
    setRevoking(id);
    try {
      const res = await fetch(
        `/api/admin/invites/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        toast.error("Couldn't revoke invite", {
          description:
            payload?.error?.message ?? `Revoke failed (HTTP ${res.status}).`,
        });
        return;
      }
      toast.success(`Invite for ${email} revoked.`);
      router.refresh();
    } catch (err) {
      toast.error("Network error revoking invite", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-sm uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Invited by</th>
            <th className="px-3 py-2 font-medium">Sent</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="w-24 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {invites.map((inv) => {
            const expiresIn = new Date(inv.expires_at).getTime() - Date.now();
            const expiringSoon = expiresIn < 60 * 60 * 1000; // < 1h
            return (
              <tr
                key={inv.id}
                className="border-b transition-smooth last:border-b-0 hover:bg-muted/40"
                data-testid="pending-invite-row"
              >
                <td className="px-3 py-2 font-medium">{inv.email}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center rounded border border-input px-2 py-0.5 text-sm">
                    {inv.role}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm text-muted-foreground">
                  {inv.invited_by_email ?? "(deleted user)"}
                </td>
                <td className="px-3 py-2 text-sm text-muted-foreground">
                  <span data-screenshot-mask>
                    {formatRelativeTime(inv.created_at)}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm">
                  <span
                    className={
                      expiringSoon
                        ? "text-warning"
                        : "text-muted-foreground"
                    }
                    data-screenshot-mask
                  >
                    {formatRelativeTime(inv.expires_at)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void revoke(inv.id, inv.email)}
                    disabled={revoking === inv.id}
                    className="rounded border px-2 py-0.5 text-sm text-destructive transition-smooth hover:bg-destructive/10 disabled:opacity-60"
                    data-testid="invite-revoke-button"
                  >
                    {revoking === inv.id ? "…" : "Revoke"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
