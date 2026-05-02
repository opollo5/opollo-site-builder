"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type { PlatformCompanyListItem } from "@/lib/platform/companies";

// P3-1 — client shell for /admin/companies. Renders the table; the
// "New company" button is a placeholder until P3-2 lands the create
// flow. Server component supplies the initial list.

export function PlatformCompaniesListClient({
  companies,
}: {
  companies: PlatformCompanyListItem[];
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Companies</H1>
          <Lead className="mt-0.5">
            {companies.length === 0
              ? "No customer companies yet."
              : `${companies.length} ${companies.length === 1 ? "company" : "companies"} on the platform.`}
          </Lead>
        </div>
        <Button data-testid="add-company-button" disabled>
          <Plus aria-hidden className="h-4 w-4" />
          New company (P3-2)
        </Button>
      </div>

      <div
        className="mt-4 overflow-hidden rounded-lg border bg-card"
        data-testid="platform-companies-table"
      >
        {companies.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No companies yet — click <strong>New company</strong> to add one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                  className="border-b last:border-b-0"
                  data-testid={`platform-company-row-${c.slug}`}
                >
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.slug}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.domain ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.member_count}
                  </td>
                  <td className="px-4 py-3 text-xs">
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
