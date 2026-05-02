"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";

// AUTH-FOUNDATION P3 — role enum migrated from
// (admin, operator, viewer) to (super_admin, admin, user).
// super_admin is the locked top tier; this dropdown only offers
// admin and user since super_admin can't be assigned via this route
// (and the row is disabled when the target is already super_admin).
type Role = "super_admin" | "admin" | "user";
type AssignableRole = Exclude<Role, "super_admin">;

// ---------------------------------------------------------------------------
// C-2 — Optimistic UI on role change.
//
// Old behaviour: dropdown changed value, request sent, on failure
// router.refresh() rolled back via server-rendered re-fetch — slow
// + visually jarring.
//
// New behaviour: dropdown updates immediately to the operator's
// chosen value, request fires in the background, on success a sonner
// toast confirms, on failure the dropdown snaps back to the original
// value and an error toast surfaces. Operator never feels the
// network round-trip.
// ---------------------------------------------------------------------------

export function UserRoleActionCell({
  userId,
  currentRole,
  selfUserId,
}: {
  userId: string;
  currentRole: Role;
  selfUserId: string | null;
}) {
  const router = useRouter();
  // Optimistic local mirror of the server's role. Server-rendered
  // currentRole is the source of truth; this state lets us flip the
  // dropdown immediately without waiting for the round-trip.
  const [optimisticRole, setOptimisticRole] = useState<Role>(currentRole);
  const [submitting, setSubmitting] = useState(false);

  const isSelf = selfUserId !== null && selfUserId === userId;
  const isSuperAdmin = currentRole === "super_admin";

  async function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as AssignableRole;
    if (newRole === optimisticRole) return;
    const previous = optimisticRole;

    setOptimisticRole(newRole);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/role`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        // Roll back the visual state immediately and surface the
        // server's reason via toast.
        setOptimisticRole(previous);
        toast.error("Couldn't change role", {
          description:
            payload?.error?.message ??
            `Role change failed (HTTP ${res.status}). The previous role has been restored.`,
        });
        return;
      }
      toast.success(`Role updated to ${newRole}`);
      // Server-rendered list still reflects the old role until refresh;
      // re-fetch so the rest of the table catches up.
      router.refresh();
    } catch (err) {
      setOptimisticRole(previous);
      toast.error("Network error changing role", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  // super_admin row: render the role as a static label, never a
  // dropdown. The DB-level guard_super_admin trigger blocks role
  // changes anyway; surfacing as a dropdown would mislead the
  // operator into thinking they can demote.
  if (isSuperAdmin) {
    return (
      <span
        className="inline-flex items-center rounded border border-input bg-muted/50 px-2 py-0.5 text-sm text-muted-foreground"
        title="Super admin cannot be modified."
      >
        super_admin
      </span>
    );
  }

  return (
    <select
      value={optimisticRole}
      onChange={handleChange}
      disabled={isSelf || submitting}
      aria-label={`Change role for user ${userId}`}
      title={isSelf ? "You cannot change your own role." : undefined}
      className="rounded border bg-background px-2 py-1 text-sm transition-smooth disabled:opacity-60"
    >
      <option value="admin">admin</option>
      <option value="user">user</option>
    </select>
  );
}
