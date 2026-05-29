import { redirect } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { IngestClient } from "@/components/image/IngestClient";

export const dynamic = "force-dynamic";

export default async function ImageIngestPage() {
  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/company/image/ingest");
  if (!session.company) redirect("/company");

  const companyId = session.company.companyId;
  if (!await canDo(companyId, "create_post")) redirect("/company");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk image generation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a spreadsheet or Word document to generate branded images for multiple posts at once.
        </p>
      </div>
      <IngestClient companyId={companyId} />
    </div>
  );
}
