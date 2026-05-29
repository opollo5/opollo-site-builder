import { redirect, notFound } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { list_templates } from "@/lib/image/templates";
import { TemplateEditor } from "@/components/image/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getCurrentPlatformSession();
  if (!session) redirect(`/login?next=/company/image/templates/${id}/edit`);
  if (!session.company) redirect("/company");

  const companyId = session.company.companyId;
  const [canEdit, templates] = await Promise.all([
    canDo(companyId, "create_post"),
    list_templates(companyId),
  ]);

  if (!canEdit) redirect("/company/image/templates");

  const template = templates.find((t) => t.id === id);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <TemplateEditor
        template={template}
        companyId={companyId}
        userId={session.userId}
      />
    </div>
  );
}
