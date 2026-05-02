import { notFound } from "next/navigation";

import { PlatformCompanyDetail } from "@/components/PlatformCompanyDetail";
import { getPlatformCompany } from "@/lib/platform/companies";

// P3-3 — Opollo admin company detail. Server-rendered. Loads company +
// members + pending invitations via a single lib helper that fans out
// three parallel queries. Read-only this slice; invite-from-detail
// (P3-4) wires actions onto this page.

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const result = await getPlatformCompany(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load company: {result.error.message}
      </div>
    );
  }
  return <PlatformCompanyDetail detail={result.data} />;
}
