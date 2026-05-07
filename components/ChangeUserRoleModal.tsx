"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Spec 18 PR B — Change user role modal.
//
// Replaces the inline <select> in the Users table cell. Editing a
// user's role now happens through this modal opened from the row's
// `...` menu — same pattern as the rest of the admin UI's destructive
// / structured-write actions.
//
// Calls PATCH /api/admin/users/[id]/role with { role: "admin" | "user" }.
// The route's existing guards (no self-modification, no super_admin
// demotion) still apply server-side.
// ---------------------------------------------------------------------------

type Role = "super_admin" | "admin" | "user";
type AssignableRole = Exclude<Role, "super_admin">;

const ROLE_OPTIONS: Array<{ value: AssignableRole; label: string; description: string }> = [
  {
    value: "admin",
    label: "Admin",
    description: "Full read/write across all admin surfaces.",
  },
  {
    value: "user",
    label: "User",
    description: "Standard access, no admin surfaces.",
  },
];

export interface ChangeUserRoleModalProps {
  open: boolean;
  userId: string;
  email: string;
  currentRole: Role;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangeUserRoleModal({
  open,
  userId,
  email,
  currentRole,
  onClose,
  onSuccess,
}: ChangeUserRoleModalProps) {
  const initial: AssignableRole =
    currentRole === "super_admin" ? "admin" : currentRole;
  const [selected, setSelected] = useState<AssignableRole>(initial);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSelected(initial);
    // initial only matters at open time — currentRole from props
    // determines it; we want the modal to reset each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentRole]);

  async function handleConfirm() {
    if (selected === currentRole) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/role`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: selected }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        toast.error("Couldn't change role", {
          description:
            payload?.error?.message ??
            `Role change failed (HTTP ${res.status}).`,
        });
        return;
      }
      onSuccess();
    } catch (err) {
      toast.error("Network error changing role", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Pick a new role for <span className="font-medium text-foreground">{email}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Role">
          {ROLE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 transition-smooth hover:border-ring has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="role"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                disabled={submitting}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {opt.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {opt.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || selected === currentRole}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
