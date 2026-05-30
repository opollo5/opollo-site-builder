import { redirect, notFound } from "next/navigation";

import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { list_templates } from "@/lib/image/templates";
import { TemplateEditor } from "@/components/image/TemplateEditor";
import { EditorShell } from "@/components/image/editor";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";

export const dynamic = "force-dynamic";

// Full-viewport layout — suppress the platform shell padding.
export const metadata = { title: "Template Editor" };

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

  // Route to v2 editor for schema_version=2, legacy editor for schema_version=1.
  if (template.schemaVersion === TEMPLATE_SCHEMA_VERSION && template.resolvedTemplate) {
    // Full-viewport v2 editor (no surrounding platform chrome).
    return (
      <EditorShell
        template={template.resolvedTemplate}
        companyId={companyId}
        templateId={id}
      />
    );
  }

  // Legacy v1 editor (schema_version=1 / A-NEW-3 format).
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
