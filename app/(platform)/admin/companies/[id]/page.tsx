import { notFound } from "next/navigation";

import { PlatformCompanyDetail } from "@/components/PlatformCompanyDetail";
import { TDetailSummary } from "@/templates";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getPlatformCompany } from "@/lib/platform/companies";
import { joinCompanyAsAdmin } from "../_actions";

// P3-3 — Opollo admin company detail. Server-rendered. Loads company +
// members + pending invitations via a single lib helper that fans out
// three parallel queries. Read-only this slice; invite-from-detail
// (P3-4) wires actions onto this page.

export const dynamic = "force-dynamic";

const BREADCRUMB = [
  { label: "Admin", href: "/admin/sites" },
  { label: "Companies", href: "/admin/companies" },
];

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [result, session] = await Promise.all([
    getPlatformCompany(params.id),
    getCurrentPlatformSession(),
  ]);

  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <TDetailSummary
        title="Failed to load company"
        breadcrumb={[...BREADCRUMB, { label: "Error" }]}
        sections={[{
          content: (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              {result.error.message}
            </div>
          ),
        }]}
      />
    );
  }

  const isCurrentUserMember =
    !!session &&
    result.data.members.some((m) => m.user_id === session.userId);

  const boundJoinAction = session?.isOpolloStaff
    ? joinCompanyAsAdmin.bind(null, params.id)
    : null;

  const { company } = result.data;

  return (
    <TDetailSummary
      title={company.name}
      breadcrumb={[...BREADCRUMB, { label: company.name }]}
      meta={
        <>
          {company.is_opollo_internal && (
            <span
              className="rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary"
              data-testid="company-internal-badge"
            >
              Opollo internal
            </span>
          )}
          <span className="font-mono" data-testid="company-detail-slug">
            {company.slug}
          </span>
          {company.domain && (
            <span className="font-mono">{company.domain}</span>
          )}
        </>
      }
      sections={[{
        content: (
          <PlatformCompanyDetail
            detail={result.data}
            isOpolloStaff={session?.isOpolloStaff ?? false}
            isCurrentUserMember={isCurrentUserMember}
            joinAction={boundJoinAction}
          />
        ),
      }]}
    />
  );
}
