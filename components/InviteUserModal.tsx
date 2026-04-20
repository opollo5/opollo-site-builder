"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      email: string;
      actionLink: string | null;
    }
  | { kind: "error"; message: string };

export function InviteUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (open) {
      setEmail("");
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
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: { email: string; action_link: string | null };
          }
        | { ok: false; error: { message?: string } }
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
        actionLink: payload.data.action_link,
      });
      // Refresh the users table so the new pending user row appears.
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
          New users start as <code>viewer</code>. Promote from the users list
          after they accept.
        </p>

        {status.kind === "success" ? (
          <div className="mt-4 space-y-3">
            <div
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm"
              role="status"
            >
              Invite generated for{" "}
              <span className="font-medium">{status.email}</span>.
            </div>
            {status.actionLink && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="invite-action-link"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Invite URL (copy + share if email delivery is disabled)
                </label>
                <Input
                  id="invite-action-link"
                  readOnly
                  value={status.actionLink}
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
              />
            </div>
            {status.kind === "error" && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
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
              <Button type="submit" disabled={submitting}>
                {submitting ? "Inviting…" : "Send invite"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
