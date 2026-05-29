import { redirect, notFound } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { BatchResultsClient } from "@/components/image/BatchResultsClient";

export const dynamic = "force-dynamic";

export default async function BatchResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getCurrentPlatformSession();
  if (!session) redirect(`/login?next=/company/image/batches/${id}`);
  if (!session.company) redirect("/company");

  const companyId = session.company.companyId;
  if (!await canDo(companyId, "create_post")) redirect("/company");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Batch results</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review generated images. Approve to attach to a draft; reject to discard.
          </p>
        </div>
        <a href="/company/image/batches" className="text-sm text-muted-foreground hover:text-foreground underline">
          ← All batches
        </a>
      </div>
      <BatchResultsClient batchId={id} companyId={companyId} />
    </div>
  );
}
