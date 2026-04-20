"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

type Role = "admin" | "operator" | "viewer";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = selfUserId !== null && selfUserId === userId;

  async function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as Role;
    if (newRole === currentRole) return;

    setSubmitting(true);
    setError(null);
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
        setError(
          payload?.error?.message ??
            `Role change failed (HTTP ${res.status}).`,
        );
        // Revert the visual state — router.refresh would re-render
        // with the stale role, but we want the select to snap back
        // immediately so the operator doesn't think the change
        // landed.
        router.refresh();
        setSubmitting(false);
        return;
      }
      // Server-rendered page; refresh re-fetches the list with the
      // new role.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      router.refresh();
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={currentRole}
        onChange={handleChange}
        disabled={isSelf || submitting}
        aria-label={`Change role for user ${userId}`}
        title={isSelf ? "You cannot change your own role." : undefined}
        className="rounded border bg-background px-2 py-1 text-xs disabled:opacity-60"
      >
        <option value="admin">admin</option>
        <option value="operator">operator</option>
        <option value="viewer">viewer</option>
      </select>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
