import { redirect } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { list_templates } from "@/lib/image/templates";
import { TemplateListClient } from "@/components/image/TemplateListClient";

export const dynamic = "force-dynamic";

export default async function ImageTemplatesPage() {
  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/company/image/templates");
  if (!session.company) redirect("/company");

  const companyId = session.company.companyId;
  const [canCreate, templates] = await Promise.all([
    canDo(companyId, "create_post"),
    list_templates(companyId),
  ]);

  if (!canCreate) redirect("/company");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Image templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customise the overlay layout, font, and logo position for each image format.
          </p>
        </div>
      </div>
      <TemplateListClient companyId={companyId} templates={templates} />
    </div>
  );
}
