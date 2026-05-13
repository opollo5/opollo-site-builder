"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toastSuccess } from "@/lib/toast-success";

// ---------------------------------------------------------------------------
// Bundle.social ↔ social_connections reconciliation surface.
//
// Lives at /admin/maintenance/social-connections. Hits the reconcile API
// (POST /api/admin/maintenance/reconcile-bundlesocial) in scan-only mode
// to surface divergences, then either bulk-fixes them all or applies
// each fix one-row-at-a-time via a "Fix this divergence" button.
//
// Divergence kinds:
//   ghost   — bundle.social has an account; no DB row matches it.
//             Fix: disconnect the bundle.social account.
//   phantom — DB has an active row; bundle.social has nothing.
//             Fix: mark the DB row 'disconnected'.
//   mismatch — both sides have an entry but identity drifted.
//              Fix: re-sync the DB row from bundle.social.
// ---------------------------------------------------------------------------

type DivergenceKind = "ghost" | "phantom" | "mismatch";

type Divergence = {
  kind: DivergenceKind;
  team_id: string;
  platform: string;
  bundle_account_id: string | null;
  bundle_external_id: string | null;
  bundle_display_name: string | null;
  db_row_id: string | null;
  db_company_id: string | null;
  db_platform: string | null;
  db_display_name: string | null;
  db_external_account_id: string | null;
  reason: string;
};

type ScanResponse = {
  ok: boolean;
  data?: {
    applied: boolean;
    scanned_teams: string[];
    scanned_platforms: string[];
    divergences: Divergence[];
    scan_errors: Array<{ team_id: string; platform: string; message: string }>;
    apply_results?: Array<{
      divergence: Divergence;
      ok: boolean;
      action: string | null;
      detail: string | null;
      error: string | null;
    }>;
  };
  error?: { message: string };
};

type LastResult = {
  scannedAt: string;
  teams: string[];
  platforms: string[];
  divergences: Divergence[];
  scanErrors: Array<{ team_id: string; platform: string; message: string }>;
  applied: boolean;
  applyErrors: number;
};

const KIND_LABEL: Record<DivergenceKind, string> = {
  ghost: "Ghost (BS has, DB doesn't)",
  phantom: "Phantom (DB has, BS doesn't)",
  mismatch: "Mismatch (drift)",
};

const KIND_PILL: Record<DivergenceKind, string> = {
  ghost: "bg-amber-100 text-amber-900",
  phantom: "bg-rose-100 text-rose-900",
  mismatch: "bg-blue-100 text-blue-900",
};

export function BundlesocialReconcileSection() {
  const router = useRouter();
  const [busy, setBusy] = useState<"scan" | "apply-all" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);

  async function callReconcile(opts: {
    apply: boolean;
    divergence?: Divergence;
  }): Promise<ScanResponse | null> {
    setError(null);
    // For one-row apply we ship the team_id + platform of just that row;
    // the scan + apply pass on the server still walks the full set but
    // only this row matters when filtered down to one (team, platform).
    const body = opts.divergence
      ? {
          apply: opts.apply,
          team_ids: [opts.divergence.team_id],
          platforms: [opts.divergence.platform],
        }
      : { apply: opts.apply };
    const res = await fetch(
      "/api/admin/maintenance/reconcile-bundlesocial",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => null)) as ScanResponse | null;
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message ?? `Request failed (${res.status}).`);
      return null;
    }
    return json;
  }

  async function handleScan() {
    setBusy("scan");
    const json = await callReconcile({ apply: false });
    setBusy(null);
    if (!json?.data) return;
    setLast({
      scannedAt: new Date().toISOString(),
      teams: json.data.scanned_teams,
      platforms: json.data.scanned_platforms,
      divergences: json.data.divergences,
      scanErrors: json.data.scan_errors,
      applied: false,
      applyErrors: 0,
    });
  }

  async function handleApplyAll() {
    if (
      !window.confirm(
        "Apply all recommended fixes? Each divergence will be remediated:\n" +
          "  ghosts → disconnected from bundle.social\n" +
          "  phantoms → marked status='disconnected' in our DB\n" +
          "  mismatches → re-synced from bundle.social\n\n" +
          "Audit logged to platform_events.",
      )
    )
      return;
    setBusy("apply-all");
    const json = await callReconcile({ apply: true });
    setBusy(null);
    if (!json?.data) return;
    const applyErrors =
      json.data.apply_results?.filter((r) => !r.ok).length ?? 0;
    setLast({
      scannedAt: new Date().toISOString(),
      teams: json.data.scanned_teams,
      platforms: json.data.scanned_platforms,
      divergences: json.data.divergences,
      scanErrors: json.data.scan_errors,
      applied: true,
      applyErrors,
    });
    if (applyErrors === 0) {
      toastSuccess(
        `Reconcile applied — ${json.data.divergences.length} divergence(s) fixed.`,
      );
    } else {
      setError(
        `${applyErrors} of ${json.data.divergences.length} fix(es) failed. See the table below for details.`,
      );
    }
    router.refresh();
  }

  async function handleApplyOne(div: Divergence) {
    const key = `${div.kind}-${div.team_id}-${div.platform}`;
    if (
      !window.confirm(
        `Fix this divergence?\n\n  kind: ${div.kind}\n  team: ${div.team_id}\n  platform: ${div.platform}\n  reason: ${div.reason}`,
      )
    )
      return;
    setBusy(key);
    const json = await callReconcile({ apply: true, divergence: div });
    setBusy(null);
    if (!json?.data) return;
    const applied = json.data.apply_results?.[0];
    if (applied?.ok) {
      toastSuccess(`Fixed: ${applied.action}`);
      router.refresh();
    } else if (applied?.error) {
      setError(`Fix failed: ${applied.error}`);
    }
    // Re-scan locally to refresh the table view too.
    void handleScan();
  }

  return (
    <section
      className="mb-6 rounded-lg border bg-card p-4"
      data-testid="bundlesocial-reconcile-section"
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            Bundle.social reconciliation
          </h2>
          <p className="text-sm text-muted-foreground">
            Compare every (team, platform) tuple between bundle.social and
            our DB. Detects ghosts / phantoms / mismatches and fixes them
            either in bulk or per-row.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleScan}
            disabled={busy !== null}
            data-testid="reconcile-scan-button"
          >
            {busy === "scan" ? "Scanning…" : "Scan for ghosts"}
          </Button>
          {last && last.divergences.length > 0 && !last.applied ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleApplyAll}
              disabled={busy !== null}
              data-testid="reconcile-apply-all-button"
            >
              {busy === "apply-all" ? "Applying…" : "Apply all fixes"}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="reconcile-error"
        >
          {error}
        </p>
      ) : null}

      {!last ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="reconcile-idle"
        >
          Click <strong>Scan for ghosts</strong> to walk every team × platform.
        </p>
      ) : (
        <div data-testid="reconcile-result">
          <p className="mb-2 text-sm text-muted-foreground">
            Scanned <strong>{last.teams.length}</strong> team(s) ×{" "}
            <strong>{last.platforms.length}</strong> platform(s) ·{" "}
            <strong>{last.divergences.length}</strong> divergence(s)
            {last.scanErrors.length > 0 ? (
              <>
                {" · "}
                <span className="text-amber-700">
                  {last.scanErrors.length} probe error(s)
                </span>
              </>
            ) : null}
            {last.applied ? (
              <>
                {" · "}
                <span className="text-emerald-700">
                  fixes applied · {last.applyErrors} failure(s)
                </span>
              </>
            ) : null}
            {" · "}
            <span className="text-xs italic">
              at {new Date(last.scannedAt).toLocaleTimeString()}
            </span>
          </p>
          {last.divergences.length === 0 ? (
            <div
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              data-testid="reconcile-clean"
            >
              ✓ bundle.social and the DB are in sync. No ghosts, phantoms,
              or mismatches.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border bg-card">
              <table
                className="w-full text-sm"
                data-testid="reconcile-divergences-table"
              >
                <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2">Platform</th>
                    <th className="px-3 py-2">bundle.social</th>
                    <th className="px-3 py-2">DB row</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {last.divergences.map((d, i) => {
                    const key = `${d.kind}-${d.team_id}-${d.platform}`;
                    return (
                      <tr
                        key={`${key}-${i}`}
                        className="border-b last:border-b-0"
                        data-testid={`reconcile-row-${i}`}
                      >
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_PILL[d.kind]}`}
                          >
                            {KIND_LABEL[d.kind]}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {d.team_id.slice(0, 8)}…
                        </td>
                        <td className="px-3 py-2">{d.platform}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {d.bundle_account_id
                            ? `${d.bundle_account_id.slice(0, 12)}…`
                            : "—"}
                          {d.bundle_display_name ? (
                            <div className="text-xs italic text-muted-foreground">
                              {d.bundle_display_name}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {d.db_row_id ? `${d.db_row_id.slice(0, 12)}…` : "—"}
                          {d.db_display_name ? (
                            <div className="text-xs italic text-muted-foreground">
                              {d.db_display_name}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{d.reason}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleApplyOne(d)}
                            disabled={busy !== null}
                            data-testid={`reconcile-fix-${i}`}
                          >
                            {busy === key ? "Fixing…" : "Fix this divergence"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {last.scanErrors.length > 0 ? (
            <details className="mt-3 rounded border bg-muted/20 p-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Probe errors ({last.scanErrors.length})
              </summary>
              <ul className="mt-2 list-disc pl-5">
                {last.scanErrors.map((e, i) => (
                  <li key={i}>
                    <code>
                      {e.team_id.slice(0, 8)}…/{e.platform}
                    </code>
                    : {e.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
