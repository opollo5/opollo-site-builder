"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";

// AUTH-FOUNDATION P4.4 — Trusted-devices listing on /account/devices.
//
// Per-row "Sign out this device" → DELETE /api/account/devices/[id]
// Plus a top-level "Sign out all other devices" → POST
// /api/account/devices/sign-out-others (when more than one trusted
// device exists AND a current device cookie is present).

interface DeviceRow {
  id: string;
  device_id: string;
  ua_string: string | null;
  trusted_until: string;
  last_used_at: string;
  created_at: string;
  is_current_device: boolean;
}

export function TrustedDevicesList({
  devices,
  hasCurrentDevice,
}: {
  devices: DeviceRow[];
  hasCurrentDevice: boolean;
}) {
  const router = useRouter();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  async function revokeOne(id: string, label: string) {
    if (!window.confirm(`Sign out ${label}? It will need email approval again on its next sign-in.`)) return;
    setRevokingId(id);
    try {
      const res = await fetch(
        `/api/account/devices/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        toast.error("Couldn't sign out device", {
          description: payload?.error?.message ?? `Failed (HTTP ${res.status}).`,
        });
        return;
      }
      toast.success(`${label} signed out.`);
      router.refresh();
    } finally {
      setRevokingId(null);
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Sign out every device other than this one?")) return;
    setRevokingOthers(true);
    try {
      const res = await fetch("/api/account/devices/sign-out-others", {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { revoked_count: number } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        toast.error("Couldn't sign out other devices", {
          description: payload?.ok === false ? payload.error.message : `Failed (HTTP ${res.status}).`,
        });
        return;
      }
      toast.success(
        `${payload.data.revoked_count} other ${payload.data.revoked_count === 1 ? "device" : "devices"} signed out.`,
      );
      router.refresh();
    } finally {
      setRevokingOthers(false);
    }
  }

  const otherCount = devices.filter((d) => !d.is_current_device).length;
  const showRevokeOthers = hasCurrentDevice && otherCount >= 1;

  return (
    <div className="space-y-4">
      {showRevokeOthers && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => void revokeOthers()}
            disabled={revokingOthers}
            data-testid="revoke-other-devices"
          >
            {revokingOthers
              ? "Signing out…"
              : `Sign out ${otherCount} other ${otherCount === 1 ? "device" : "devices"}`}
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 font-medium">Last used</th>
              <th className="px-3 py-2 font-medium">Trusted until</th>
              <th className="w-32 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const label = parseUaLabel(d.ua_string);
              return (
                <tr
                  key={d.id}
                  className="border-b align-top last:border-b-0"
                  data-testid="device-row"
                  data-current-device={d.is_current_device ? "true" : "false"}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{label}</div>
                    {d.is_current_device && (
                      <span className="mt-1 inline-flex items-center rounded border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-success">
                        This device
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <span data-screenshot-mask>
                      {formatRelativeTime(d.last_used_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <span data-screenshot-mask>
                      {formatRelativeTime(d.trusted_until)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void revokeOne(d.id, label)}
                      disabled={revokingId === d.id}
                      className="rounded border px-2 py-0.5 text-xs text-destructive transition-smooth hover:bg-destructive/10 disabled:opacity-60"
                      data-testid="revoke-device"
                    >
                      {revokingId === d.id ? "…" : "Sign out"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseUaLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "Device";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}
