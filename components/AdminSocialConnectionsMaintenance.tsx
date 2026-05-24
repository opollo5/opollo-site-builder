"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { toastSuccess } from "@/lib/toast-success";

// Cross-tenant identity-leak defence — Layer 4 maintenance UI.

type ConnectionRow = {
  id: string;
  company_id: string;
  profile_id: string | null;
  platform: string;
  display_name: string | null;
  bundle_social_account_id: string;
  status: string;
  external_account_id: string | null;
  external_user_id: string | null;
  external_identity_hash: string | null;
  connected_at: string;
  last_health_check_at: string;
};
type CompanyRow = { id: string; name: string; allow_cross_tenant_identity: boolean };
type ProfileRow = { id: string; company_id: string; name: string };

type Props = {
  connections: ConnectionRow[];
  companies: CompanyRow[];
  profiles: ProfileRow[];
};

type SortKey =
  | "company"
  | "profile"
  | "platform"
  | "display_name"
  | "status"
  | "identity_hash"
  | "connected_at";

const PLATFORM_TO_BUNDLE: Record<string, string> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export function AdminSocialConnectionsMaintenance({
  connections,
  companies,
  profiles,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [duplicateFilter, setDuplicateFilter] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("identity_hash");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.id, p])),
    [profiles],
  );

  const conflicts = useMemo(() => {
    const byHash = new Map<string, ConnectionRow[]>();
    const byAccount = new Map<string, ConnectionRow[]>();
    const byUser = new Map<string, ConnectionRow[]>();
    for (const c of connections) {
      if (c.external_identity_hash) {
        const arr = byHash.get(c.external_identity_hash) ?? [];
        arr.push(c);
        byHash.set(c.external_identity_hash, arr);
      }
      if (c.external_account_id) {
        const k = `${c.platform}::${c.external_account_id}`;
        const arr = byAccount.get(k) ?? [];
        arr.push(c);
        byAccount.set(k, arr);
      }
      if (c.external_user_id) {
        const k = `${c.platform}::${c.external_user_id}`;
        const arr = byUser.get(k) ?? [];
        arr.push(c);
        byUser.set(k, arr);
      }
    }
    const hashDupes = [...byHash.values()].filter(
      (arr) => new Set(arr.map((r) => r.company_id)).size > 1,
    );
    const accountDupes = [...byAccount.values()].filter(
      (arr) => new Set(arr.map((r) => r.company_id)).size > 1,
    );
    const userDupes = [...byUser.values()].filter(
      (arr) => new Set(arr.map((r) => r.company_id)).size > 1,
    );
    const conflictRowIds = new Set<string>();
    for (const g of [...hashDupes, ...accountDupes, ...userDupes])
      for (const r of g) conflictRowIds.add(r.id);
    return {
      hashDupes,
      accountDupes,
      userDupes,
      conflictRowIds,
      total: hashDupes.length + accountDupes.length + userDupes.length,
    };
  }, [connections]);

  const filtered = useMemo(() => {
    let rows = connections;
    if (companyFilter) rows = rows.filter((r) => r.company_id === companyFilter);
    if (platformFilter) rows = rows.filter((r) => r.platform === platformFilter);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (duplicateFilter)
      rows = rows.filter((r) => conflicts.conflictRowIds.has(r.id));
    return [...rows].sort((a, b) => {
      const cmp = (() => {
        switch (sortKey) {
          case "company":
            return (companyById.get(a.company_id)?.name ?? "").localeCompare(
              companyById.get(b.company_id)?.name ?? "",
            );
          case "profile":
            return (profileById.get(a.profile_id ?? "")?.name ?? "").localeCompare(
              profileById.get(b.profile_id ?? "")?.name ?? "",
            );
          case "platform":
            return a.platform.localeCompare(b.platform);
          case "display_name":
            return (a.display_name ?? "").localeCompare(b.display_name ?? "");
          case "status":
            return a.status.localeCompare(b.status);
          case "identity_hash":
            return (a.external_identity_hash ?? "ZZZ").localeCompare(
              b.external_identity_hash ?? "ZZZ",
            );
          case "connected_at":
            return a.connected_at.localeCompare(b.connected_at);
        }
      })();
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [
    connections,
    companyFilter,
    platformFilter,
    statusFilter,
    duplicateFilter,
    sortKey,
    sortDir,
    companyById,
    profileById,
    conflicts.conflictRowIds,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function callAction(
    url: string,
    method: "POST" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(json?.error?.message ?? `Request failed (${res.status}).`);
      return false;
    }
    return true;
  }

  async function handleDisconnect(row: ConnectionRow) {
    if (!row.profile_id) {
      setError("Cannot disconnect a connection without a profile_id.");
      return;
    }
    if (
      !window.confirm(
        `Disconnect ${row.platform} (${row.display_name ?? row.bundle_social_account_id}) from ${
          companyById.get(row.company_id)?.name ?? "this company"
        }?`,
      )
    )
      return;
    setBusy(row.id);
    const bundleType = PLATFORM_TO_BUNDLE[row.platform] ?? row.platform.toUpperCase();
    const ok = await callAction(
      `/api/admin/companies/${row.company_id}/social-profiles/${row.profile_id}/disconnect`,
      "POST",
      { platform: bundleType },
    );
    setBusy(null);
    if (ok) {
      toastSuccess("Connection disconnected.");
      router.refresh();
    }
  }

  async function handleRefresh(row: ConnectionRow) {
    setBusy(row.id);
    const ok = await callAction(
      `/api/admin/maintenance/social-connections/${row.id}/refresh-identity`,
      "POST",
    );
    setBusy(null);
    if (ok) {
      toastSuccess("Identity refreshed.");
      router.refresh();
    }
  }

  async function handleReattribute(row: ConnectionRow) {
    const newCompanyId = window.prompt("Target company_id (UUID):", row.company_id);
    if (!newCompanyId || newCompanyId === row.company_id) return;
    const newProfileId = window.prompt(
      "Target profile_id (UUID, or blank for null):",
      row.profile_id ?? "",
    );
    setBusy(row.id);
    const ok = await callAction(
      `/api/admin/maintenance/social-connections/${row.id}/reattribute`,
      "POST",
      {
        target_company_id: newCompanyId.trim(),
        target_profile_id: newProfileId?.trim() || null,
      },
    );
    setBusy(null);
    if (ok) {
      toastSuccess("Connection reattributed.");
      router.refresh();
    }
  }

  async function handleToggleOverride(row: ConnectionRow) {
    const company = companyById.get(row.company_id);
    if (!company) return;
    const current = company.allow_cross_tenant_identity;
    if (
      !window.confirm(
        `${current ? "Disable" : "Enable"} cross-tenant identity override for ${company.name}? This is audited.`,
      )
    )
      return;
    setBusy(row.id);
    const ok = await callAction(
      `/api/admin/maintenance/companies/${row.company_id}/toggle-cross-tenant-override`,
      "POST",
      { value: !current },
    );
    setBusy(null);
    if (ok) {
      toastSuccess(`Override ${!current ? "enabled" : "disabled"}.`);
      router.refresh();
    }
  }

  const platformOptions = useMemo(
    () => [...new Set(connections.map((c) => c.platform))].sort(),
    [connections],
  );
  const statusOptions = useMemo(
    () => [...new Set(connections.map((c) => c.status))].sort(),
    [connections],
  );

  return (
    <div data-testid="admin-social-connections-maintenance">
      {conflicts.total === 0 ? (
        <div
          className="mb-4 rounded-md border border-[--color-success-border] bg-[--color-success-bg] px-3 py-2 text-sm text-[--color-success-fg]"
          role="status"
          data-testid="maintenance-banner-clean"
        >
          ✓ No identity conflicts.
        </div>
      ) : (
        <details
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="maintenance-banner-conflicts"
        >
          <summary className="cursor-pointer font-medium">
            {conflicts.total} identity conflict
            {conflicts.total === 1 ? "" : "s"} —{" "}
            {conflicts.hashDupes.length} full-hash,{" "}
            {conflicts.accountDupes.length} account-id,{" "}
            {conflicts.userDupes.length} user-id. Expand.
          </summary>
          <div className="mt-2 space-y-3">
            {[
              { label: "Full-identity hash duplicates", groups: conflicts.hashDupes },
              {
                label: "Same-platform account-id duplicates",
                groups: conflicts.accountDupes,
              },
              {
                label: "Same-platform user-id duplicates",
                groups: conflicts.userDupes,
              },
            ].map((section) => (
              <div key={section.label}>
                <p className="font-medium">
                  {section.label}: {section.groups.length}
                </p>
                {section.groups.map((g, i) => (
                  <pre
                    key={i}
                    className="overflow-x-auto rounded border bg-card p-2 text-xs text-foreground"
                  >
                    {g
                      .map(
                        (r) =>
                          `  ${companyById.get(r.company_id)?.name ?? r.company_id} / ${
                            profileById.get(r.profile_id ?? "")?.name ?? "(no profile)"
                          } / ${r.platform} / ${r.display_name ?? "—"} / hash=${r.external_identity_hash?.slice(0, 8) ?? "null"}`,
                      )
                      .join("\n")}
                  </pre>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}

      {error ? (
        <p
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="maintenance-error"
        >
          {error}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="filter-company"
        >
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="filter-platform"
        >
          <option value="">All platforms</option>
          {platformOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-2 py-1 text-sm"
          data-testid="filter-status"
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={duplicateFilter}
            onChange={(e) => setDuplicateFilter(e.target.checked)}
            data-testid="filter-duplicates"
          />
          Only rows in a conflict
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm" data-testid="maintenance-table">
          <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
            <tr>
              {(
                [
                  ["company", "Company"],
                  ["profile", "Profile"],
                  ["platform", "Platform"],
                  ["display_name", "Display name"],
                  ["identity_hash", "Identity hash"],
                  ["status", "Status"],
                  ["connected_at", "Connected"],
                ] as Array<[SortKey, string]>
              ).map(([key, label]) => (
                <th
                  key={key}
                  className="cursor-pointer px-3 py-2"
                  onClick={() => toggleSort(key)}
                  data-testid={`sort-${key}`}
                >
                  {label} {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              ))}
              <th className="px-3 py-2">External account id</th>
              <th className="px-3 py-2">External user id</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const company = companyById.get(r.company_id);
              const profile = profileById.get(r.profile_id ?? "");
              const isConflict = conflicts.conflictRowIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={
                    "border-b last:border-b-0 hover:bg-muted/20 " +
                    (isConflict ? "bg-destructive/5" : "")
                  }
                  data-testid={`row-${r.id}`}
                >
                  <td className="px-3 py-2">
                    <div>{company?.name ?? r.company_id}</div>
                    {company?.allow_cross_tenant_identity ? (
                      <span className="text-xs italic text-amber-700">
                        override enabled
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{profile?.name ?? "—"}</td>
                  <td className="px-3 py-2">{r.platform}</td>
                  <td className="px-3 py-2">{r.display_name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.external_identity_hash?.slice(0, 12) ?? "—"}
                  </td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                    {new Date(r.connected_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.external_account_id?.slice(0, 24) ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.external_user_id?.slice(0, 24) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRefresh(r)}
                        disabled={busy === r.id}
                        data-testid={`row-refresh-${r.id}`}
                      >
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReattribute(r)}
                        disabled={busy === r.id}
                        data-testid={`row-reattribute-${r.id}`}
                      >
                        Reattribute
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDisconnect(r)}
                        disabled={busy === r.id}
                        data-testid={`row-disconnect-${r.id}`}
                      >
                        Disconnect
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleOverride(r)}
                        disabled={busy === r.id}
                        data-testid={`row-toggle-override-${r.id}`}
                      >
                        {company?.allow_cross_tenant_identity
                          ? "Disable override"
                          : "Enable override"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No connections match the filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
