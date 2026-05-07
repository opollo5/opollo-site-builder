"use client";

import Link from "next/link";

import type { PlatformCompanyListItem } from "@/lib/platform/companies";

// P3-1 — client shell for /admin/companies. Renders the table only;
// the page header (H1 + subtitle + "New company" CTA) lives in
// app/admin/companies/page.tsx via PageHeader (Spec 04 migration).

export function PlatformCompaniesListClient({
  companies,
}: {
  companies: PlatformCompanyListItem[];
}) {
  return (
    <>
      <div
        className="overflow-hidden rounded-lg border bg-card"
        data-testid="platform-companies-table"
      >
        {companies.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No companies yet — click <strong>New company</strong> to add one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Slug</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Members</th>
                <th className="px-4 py-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                  data-testid={`platform-company-row-${c.slug}`}
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/admin/companies/${c.id}`}
                      className="hover:underline"
                      data-testid={`platform-company-link-${c.slug}`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {c.slug}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.domain ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.member_count}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {c.is_opollo_internal ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        Opollo internal
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Customer</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
