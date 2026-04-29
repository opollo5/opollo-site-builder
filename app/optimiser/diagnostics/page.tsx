import { redirect } from "next/navigation";

import { checkAdminAccess } from "@/lib/admin-gate";
import { runDiagnostics } from "@/lib/optimiser/diagnostics";

export const metadata = { title: "Optimiser · Diagnostics" };
export const dynamic = "force-dynamic";

export default async function OptimiserDiagnosticsPage() {
  const access = await checkAdminAccess({ requiredRoles: ["admin"] });
  if (access.kind === "redirect") redirect(access.to);
  const report = await runDiagnostics();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Optimiser diagnostics
        </h1>
        <p className="text-sm text-muted-foreground">
          Operator wiring check. Generated{" "}
          {new Date(report.generated_at).toLocaleString()}.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Module</h2>
        <ModuleRow
          label="Schema reachable"
          ok={report.module.schema_reachable}
          detail={report.module.schema_error}
        />
        <ModuleRow
          label="OPOLLO_MASTER_KEY set"
          ok={report.module.master_key_set}
          detail={
            report.module.master_key_set
              ? undefined
              : "Required for credential encryption."
          }
        />
        <ModuleRow
          label="CRON_SECRET set"
          ok={report.module.cron_secret_set}
          detail={
            report.module.cron_secret_set
              ? undefined
              : "Required for sync + email-digest cron handlers."
          }
        />
        <ModuleRow
          label={`Email provider: ${report.module.email_provider}`}
          ok={true}
          detail={
            report.module.email_provider === "noop"
              ? "OPTIMISER_EMAIL_PROVIDER unset — digests are no-op + logged."
              : undefined
          }
        />
        <p className="pt-2 text-sm text-muted-foreground">
          Clients: {report.module.client_count} ·{" "}
          {report.module.onboarded_count} onboarded
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Data sources</h2>
        {report.sources.map((s) => (
          <article
            key={s.source}
            className="space-y-2 rounded-lg border border-border bg-card p-6"
          >
            <header className="flex items-center justify-between">
              <h3 className="font-medium">
                {s.source.replace("_", " ")}
              </h3>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  s.env.configured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {s.env.configured ? "env configured" : "env missing"}
              </span>
            </header>
            {!s.env.configured && (
              <p className="text-sm text-red-900">
                Missing: {s.env.missing.join(", ")}
              </p>
            )}
            {s.source !== "anthropic" && (
              <ul className="space-y-1 text-sm">
                <li>
                  <span className="text-muted-foreground">Connected clients: </span>
                  <span className="font-mono">{s.connected_clients}</span>
                </li>
                <li>
                  <span className="text-muted-foreground">Clients in error: </span>
                  <span
                    className={`font-mono ${s.clients_in_error > 0 ? "text-red-700" : ""}`}
                  >
                    {s.clients_in_error}
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground">
                    Last successful sync:{" "}
                  </span>
                  <span className="font-mono">
                    {s.last_successful_sync_at
                      ? new Date(s.last_successful_sync_at).toLocaleString()
                      : "(never)"}
                  </span>
                </li>
                {s.last_error && (
                  <li className="text-red-700">
                    <span>Last error: </span>
                    <span className="font-mono">{s.last_error.code}</span>
                    {s.last_error.message && (
                      <> — {s.last_error.message}</>
                    )}
                    <> at {new Date(s.last_error.at).toLocaleString()}</>
                  </li>
                )}
              </ul>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function ModuleRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div>
        <p className="font-medium">{label}</p>
        {detail && <p className="text-muted-foreground">{detail}</p>}
      </div>
      <span
        aria-hidden
        className={`mt-1 inline-block size-2.5 rounded-full ${
          ok ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
    </div>
  );
}
