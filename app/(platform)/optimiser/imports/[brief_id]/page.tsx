import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ImportSideBySide } from "@/components/optimiser/ImportSideBySide";
import { TDetailSummary } from "@/templates";
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
    <TDetailSummary
      title={`Import review — ${details.brief_page.title}`}
      breadcrumb={[
        { label: "Optimiser", href: "/optimiser" },
        { label: "Imports" },
      ]}
      meta={
        <>
          <span>
            Brief status:{" "}
            <code className="font-mono text-sm">{details.brief.status}</code>
          </span>
          <span>{details.brief_page.word_count.toLocaleString()} words captured</span>
          {details.brief_page.import_source_url && (
            <span className="font-mono text-sm">
              {details.brief_page.import_source_url}
            </span>
          )}
        </>
      }
      actions={
        briefRunHref ? (
          <Button asChild variant="outline">
            <Link href={briefRunHref}>Brief run progress</Link>
          </Button>
        ) : undefined
      }
      sections={[{
        content: (
          <ImportSideBySide
            cachedHtml={details.brief_page.source_text}
            liveUrl={details.brief_page.import_source_url}
            briefRunStatus={details.brief_run?.status ?? null}
            briefRunHref={briefRunHref}
            briefRunCreatedAt={details.brief_run?.created_at ?? null}
          />
        ),
      }]}
    />
  );
}
