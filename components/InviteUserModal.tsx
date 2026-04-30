"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// AUTH-FOUNDATION P3.3 — Invite-user modal.
//
// POSTs to /api/admin/invites (the new custom-token flow) instead of
// the legacy /api/admin/users/invite (Supabase magic-link).
//
// Role dropdown options vary by actor role per the brief's matrix:
//   - super_admin: admin OR user
//   - admin:       user only

type ActorRole = "super_admin" | "admin" | "user";
type InviteRole = "admin" | "user";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      email: string;
      role: InviteRole;
      acceptUrl: string | null;
      emailSent: boolean;
    }
  | { kind: "error"; message: string };

export function InviteUserModal({
  open,
  onClose,
  actorRole,
}: {
  open: boolean;
  onClose: () => void;
  actorRole: ActorRole;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("user");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const allowedRoles: InviteRole[] = useMemo(
    () => (actorRole === "super_admin" ? ["admin", "user"] : ["user"]),
    [actorRole],
  );

  useEffect(() => {
    if (open) {
      setEmail("");
      setRole("user");
      setStatus({ kind: "idle" });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status.kind !== "submitting") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, status, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: {
              invite_id: string;
              email: string;
              role: InviteRole;
              expires_at: string;
              accept_url: string | null;
              email_sent: boolean;
            };
          }
        | { ok: false; error: { code?: string; message?: string } }
        | null;

      if (!res.ok || !payload || payload.ok !== true) {
        const message =
          payload && payload.ok === false
            ? payload.error?.message ?? "Invite failed."
            : `Invite failed (HTTP ${res.status}).`;
        setStatus({ kind: "error", message });
        return;
      }

      setStatus({
        kind: "success",
        email: payload.data.email,
        role: payload.data.role,
        acceptUrl: payload.data.accept_url,
        emailSent: payload.data.email_sent,
      });
      // Refresh the users + invites tables so the new pending row appears.
      router.refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-user-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="invite-user-title" className="text-lg font-semibold">
          Invite user
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sends a 24-hour acceptance link via email. The invitee sets
          their own password.
        </p>

        {status.kind === "success" ? (
          <div className="mt-4 space-y-3">
            <div
              className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
              role="status"
              data-testid="invite-success"
            >
              Invite sent to{" "}
              <span className="font-medium">{status.email}</span> as{" "}
              <span className="font-medium">{status.role}</span>.
              {!status.emailSent && (
                <p className="mt-1 text-xs">
                  Email delivery failed — copy the link below to share
                  out of band.
                </p>
              )}
            </div>
            {status.acceptUrl && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="invite-accept-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Acceptance URL (copy + share if email delivery is broken)
                </label>
                <Input
                  id="invite-accept-url"
                  readOnly
                  value={status.acceptUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label
                htmlFor="invite-email"
                className="block text-sm font-medium"
              >
                Email
              </label>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                autoFocus
                data-testid="invite-email"
              />
            </div>
            <div>
              <label
                htmlFor="invite-role"
                className="block text-sm font-medium"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
                disabled={submitting || allowedRoles.length === 1}
                data-testid="invite-role"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {allowedRoles.length === 1
                  ? "Admins can only invite role=user. Ask a super_admin to invite admins."
                  : "Choose admin to grant invite + remove powers; user otherwise."}
              </p>
            </div>
            {status.kind === "error" && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="invite-error"
              >
                {status.message}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                data-testid="invite-submit"
              >
                {submitting ? "Inviting…" : "Send invite"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
