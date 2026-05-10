import { redirect } from "next/navigation";

import { ImageMetadataJobTrigger } from "@/components/admin/ImageMetadataJobTrigger";
import { PageHeader } from "@/components/ui/page-header";
import { checkAdminAccess } from "@/lib/admin-gate";

export const dynamic = "force-dynamic";

export default async function AdminMaintenancePage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Maintenance" },
          ]}
        />
        <PageHeader.Title>Maintenance</PageHeader.Title>
        <PageHeader.Subtitle>
          Background jobs and data maintenance tools.
        </PageHeader.Subtitle>
      </PageHeader>

      <div className="mt-6">
        <ImageMetadataJobTrigger />
      </div>
    </>
  );
}
