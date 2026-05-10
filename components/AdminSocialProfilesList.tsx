"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PROFILE_KIND_LABEL,
  type SocialProfile,
  type SocialProfileKind,
} from "@/lib/platform/social/profiles/types";
import { toastSuccess } from "@/lib/toast-success";

// BSP-5 — admin profile management list.
//
// Renders a table of profiles with per-row actions:
//   * Rename — opens an inline input
//   * Set as default — promotes to default; previous default flips to false
//   * Delete — confirms, refuses on default profile
//
// Plus a "Add profile" form at the top.
//
// All mutations go through /api/admin/companies/[id]/social-profiles/...
// which gates on operator role (super_admin or admin).

type Props = {
  companyId: string;
  initialProfiles: SocialProfile[];
};

type ApiResponse<T> =
  | { ok: true; data: T; timestamp: string }
  | {
      ok: false;
      error: { code: string; message: string };
      timestamp: string;
    };

const KINDS: ReadonlyArray<SocialProfileKind> = ["company", "executive"];

export function AdminSocialProfilesList({ companyId, initialProfiles }: Props) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<SocialProfile[]>(initialProfiles);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // row id or "create"
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<SocialProfileKind>("executive");

  function refreshLocal(updated: SocialProfile): void {
    setProfiles((prev) => {
      const next = prev.map((p) =>
        p.id === updated.id ? updated : { ...p, is_default: updated.is_default ? false : p.is_default },
      );
      // Re-sort: default first, then created_at asc.
      return [...next].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return a.created_at.localeCompare(b.created_at);
      });
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("create");
    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), kind: newKind }),
      },
    );
    const json = (await res.json()) as ApiResponse<{ profile: SocialProfile }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to create profile.");
      return;
    }
    toastSuccess(`Profile "${json.data.profile.name}" added.`);
    setProfiles((prev) =>
      [...prev, json.data.profile].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return a.created_at.localeCompare(b.created_at);
      }),
    );
    setNewName("");
    setNewKind("executive");
    router.refresh();
  }

  async function handleRename(profileId: string) {
    setError(null);
    setBusy(profileId);
    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      },
    );
    const json = (await res.json()) as ApiResponse<{ profile: SocialProfile }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to rename profile.");
      return;
    }
    toastSuccess("Profile renamed.");
    refreshLocal(json.data.profile);
    setEditingId(null);
    setEditName("");
    router.refresh();
  }

  async function handleSetDefault(profileId: string) {
    setError(null);
    setBusy(profileId);
    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_default: true }),
      },
    );
    const json = (await res.json()) as ApiResponse<{ profile: SocialProfile }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to set default.");
      return;
    }
    toastSuccess(`"${json.data.profile.name}" is now the default profile.`);
    refreshLocal(json.data.profile);
    router.refresh();
  }

  async function handleDelete(profileId: string, profileName: string) {
    if (
      !window.confirm(
        `Delete profile "${profileName}"? This cannot be undone. The bundle.social team for this profile will be orphaned and can be cleaned up via the reconcile script.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusy(profileId);
    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}`,
      { method: "DELETE" },
    );
    const json = (await res.json()) as ApiResponse<{ deleted_id: string }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to delete profile.");
      return;
    }
    toastSuccess(`Profile "${profileName}" deleted.`);
    setProfiles((prev) => prev.filter((p) => p.id !== profileId));
    router.refresh();
  }

  return (
    <div data-testid="admin-social-profiles">
      <form
        onSubmit={handleCreate}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-md border bg-card p-3"
        data-testid="add-profile-form"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium" htmlFor="new-profile-name">
            New profile name
          </label>
          <input
            id="new-profile-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            maxLength={80}
            placeholder="CEO Personal"
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            data-testid="new-profile-name-input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="new-profile-kind">
            Kind
          </label>
          <select
            id="new-profile-kind"
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as SocialProfileKind)}
            className="mt-1 block rounded-md border px-3 py-2 text-sm"
            data-testid="new-profile-kind-select"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {PROFILE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          disabled={busy !== null || newName.trim().length === 0}
          data-testid="add-profile-submit"
        >
          {busy === "create" ? "Adding…" : "Add profile"}
        </Button>
      </form>

      {error ? (
        <p
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="profiles-error"
        >
          {error}
        </p>
      ) : null}

      {profiles.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="profiles-empty"
        >
          No profiles. The migration should have backfilled at least one default
          profile for every company — if you see this, something has gone wrong.
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-lg border bg-card"
          data-testid="profiles-table"
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Default</th>
                <th className="px-4 py-2 font-medium">bundle.social team</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr
                  key={p.id}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                  data-testid={`profile-row-${p.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={80}
                          className="block w-full rounded-md border px-2 py-1 text-sm"
                          data-testid={`profile-edit-input-${p.id}`}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleRename(p.id)}
                          disabled={busy === p.id || editName.trim().length === 0}
                          data-testid={`profile-rename-save-${p.id}`}
                        >
                          {busy === p.id ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditName("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span data-testid={`profile-name-${p.id}`}>{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{PROFILE_KIND_LABEL[p.kind]}</td>
                  <td className="px-4 py-3">
                    {p.is_default ? (
                      <span
                        className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-900"
                        data-testid={`profile-default-pill-${p.id}`}
                      >
                        Default
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {p.bundle_social_team_id ?? (
                      <span className="italic">unprovisioned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === p.id ? null : (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          data-testid={`profile-manage-connections-${p.id}`}
                        >
                          <Link
                            href={`/admin/companies/${companyId}/social-profiles/${p.id}/connections`}
                          >
                            Connections
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditName(p.name);
                          }}
                          disabled={busy !== null}
                          data-testid={`profile-rename-${p.id}`}
                        >
                          Rename
                        </Button>
                        {!p.is_default ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSetDefault(p.id)}
                              disabled={busy !== null}
                              data-testid={`profile-set-default-${p.id}`}
                            >
                              {busy === p.id ? "…" : "Set default"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(p.id, p.name)}
                              disabled={busy !== null}
                              data-testid={`profile-delete-${p.id}`}
                            >
                              {busy === p.id ? "…" : "Delete"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
