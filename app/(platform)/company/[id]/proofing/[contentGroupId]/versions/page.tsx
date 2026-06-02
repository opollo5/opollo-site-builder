import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getVersionComparison } from "@/lib/platform/proofing/engine";
import type { VersionSnapshot } from "@/lib/platform/proofing/engine";

// ---------------------------------------------------------------------------
// /company/[id]/proofing/[contentGroupId]/versions
//
// Version comparison: side-by-side view of all versions in a content group.
// V1 = two-column layout; smart diff is deferred (B3+).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function VersionComparisonPage({
  params,
}: {
  params: Promise<{ id: string; contentGroupId: string }>;
}) {
  const { id: companyId, contentGroupId } = await params;
  const session = await getCurrentPlatformSession();
  if (!session) redirect(`/login?next=/company/${companyId}/proofing/${contentGroupId}/versions`);
  if (!await canDo(companyId, "view_calendar")) redirect(`/company/${companyId}`);

  const versions = await getVersionComparison(contentGroupId);

  return (
    <main className="p-6 space-y-6">
      <PageHeader>
        <PageHeader.Title>Version history</PageHeader.Title>
        <PageHeader.Subtitle>
          {versions.length} version{versions.length !== 1 ? "s" : ""} in this content group
        </PageHeader.Subtitle>
      </PageHeader>

      <div className="flex gap-2 flex-wrap">
        <a
          href={`/api/platform/proofing/groups/${contentGroupId}/audit?company_id=${companyId}&format=csv`}
          className="text-sm text-primary hover:underline"
          download
        >
          Export audit CSV
        </a>
      </div>

      {versions.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No versions found.</p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns:
              versions.length === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))",
          }}
        >
          {versions.map((v) => (
            <VersionCard key={v.draftId} version={v} />
          ))}
        </div>
      )}
    </main>
  );
}

function VersionCard({ version }: { version: VersionSnapshot }) {
  const statusLabel: Record<string, string> = {
    draft: "Draft",
    in_review: "In review",
    changes_requested: "Changes requested",
    in_revision: "In revision",
    approved: "Approved",
    published: "Published",
    archived: "Archived",
  };

  const statusColor: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    in_review: "bg-blue-100 text-blue-800",
    changes_requested: "bg-orange-100 text-orange-800",
    in_revision: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    published: "bg-green-200 text-green-900",
    archived: "bg-muted text-muted-foreground",
  };

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-foreground">
          v{version.versionNumber}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[version.proofState] ?? ""}`}
        >
          {statusLabel[version.proofState] ?? version.proofState}
        </span>
      </div>

      {version.content ? (
        <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-6">
          {version.content}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">— No text content —</p>
      )}

      {(version.mediaUrls ?? []).length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(version.mediaUrls ?? []).slice(0, 4).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`v${version.versionNumber} image ${i + 1}`}
              className="rounded-md border object-cover aspect-square bg-muted"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {version.approvedAt ? (
          <span>
            Approved{" "}
            {new Date(version.approvedAt).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ) : null}
        {version.archivedAt ? (
          <span className="text-muted-foreground/60">Archived</span>
        ) : null}
      </div>
    </article>
  );
}
