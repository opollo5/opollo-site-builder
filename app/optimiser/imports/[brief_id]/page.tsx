import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ImportSideBySide } from "@/components/optimiser/ImportSideBySide";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getImportDetails } from "@/lib/optimiser/page-import/read-import";

export const metadata = { title: "Optimiser · Import review" };
export const dynamic = "force-dynamic";

export default async function OptimiserImportReviewPage({
  params,
}: {
  params: { brief_id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
  });
  if (access.kind === "redirect") redirect(access.to);

  const details = await getImportDetails(params.brief_id);
  if (!details) notFound();

  const briefRunHref = details.brief_run
    ? `/admin/sites/${details.brief.site_id}/briefs/${details.brief.id}/run`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeader.Title>
          Import review — {details.brief_page.title}
        </PageHeader.Title>
        <PageHeader.Subtitle>
          Brief status:{" "}
          <code className="font-mono text-sm">{details.brief.status}</code>
          {" · "}
          {details.brief_page.word_count.toLocaleString()} words captured
          {details.brief_page.import_source_url && (
            <>
              {" · "}
              <span className="font-mono text-sm">
                {details.brief_page.import_source_url}
              </span>
            </>
          )}
        </PageHeader.Subtitle>
        {briefRunHref && (
          <PageHeader.Actions>
            <Button asChild variant="outline">
              <Link href={briefRunHref}>Brief run progress</Link>
            </Button>
          </PageHeader.Actions>
        )}
      </PageHeader>

      <ImportSideBySide
        cachedHtml={details.brief_page.source_text}
        liveUrl={details.brief_page.import_source_url}
        briefRunStatus={details.brief_run?.status ?? null}
        briefRunHref={briefRunHref}
        briefRunCreatedAt={details.brief_run?.created_at ?? null}
      />
    </div>
  );
}
