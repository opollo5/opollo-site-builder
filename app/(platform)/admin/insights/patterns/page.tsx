import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import type { IndustryPattern } from "@/lib/insights/pattern-application";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const BREADCRUMB = [
  { label: "Admin", href: "/admin" },
  { label: "Insights", href: "/admin/insights" },
  { label: "Industry Patterns" },
];

export default async function AdminInsightsPatternsPage() {
  const supabase = createRouteAuthClient();
  const { data: isOp } = await supabase.rpc("is_cap_operator");
  if (!isOp) redirect("/admin");

  const svc = getServiceRoleClient();
  const { data: patterns, error } = await svc
    .from("ins_pattern_library")
    .select("*")
    .order("mined_at", { ascending: false })
    .limit(100);

  const rows = (patterns ?? []) as IndustryPattern[];

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb segments={BREADCRUMB} />
        <PageHeader.Title>Industry Patterns</PageHeader.Title>
        <PageHeader.Subtitle>
          Cross-client anonymised patterns mined from consenting companies.
        </PageHeader.Subtitle>
      </PageHeader>

      <PageShell.Content>
        {error && (
          <p className="rounded-md border border-[var(--rd-2)] bg-[var(--rd-1)] px-4 py-3 text-sm text-[var(--rd-3)]">
            Failed to load patterns: {error.message}
          </p>
        )}
        {rows.length === 0 && !error && (
          <p className="text-sm text-[var(--tx-muted)]">
            No patterns mined yet. The weekly cron runs Sunday 06:00 UTC.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--b2)] text-left">
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Type</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Platforms</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Data</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Companies</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Posts</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Confidence</th>
                  <th className="pb-3 pr-6 font-medium text-[var(--tx-secondary)]">Mined</th>
                  <th className="pb-3 font-medium text-[var(--tx-secondary)]">Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--b1)] text-[var(--tx-primary)]">
                    <td className="py-3 pr-6 font-mono text-sm">{row.pattern_type}</td>
                    <td className="py-3 pr-6">{row.applies_to_platforms.join(", ")}</td>
                    <td className="py-3 pr-6 max-w-xs truncate font-mono text-sm text-[var(--tx-secondary)]">
                      {JSON.stringify(row.pattern_data)}
                    </td>
                    <td className="py-3 pr-6 text-center">{row.sample_size_n_companies}</td>
                    <td className="py-3 pr-6 text-center">{row.sample_size_n_posts}</td>
                    <td className="py-3 pr-6 text-center">
                      {(row.confidence_score * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 pr-6 text-[var(--tx-muted)]">
                      {new Date(row.mined_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-[var(--tx-muted)]">
                      {new Date(row.expires_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageShell.Content>
    </PageShell>
  );
}
