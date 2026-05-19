import { redirect } from "next/navigation";

import { ImageMetadataJobTrigger } from "@/components/admin/ImageMetadataJobTrigger";
import { checkAdminAccess } from "@/lib/admin-gate";
import { TDashboardFeed } from "@/templates";

export const dynamic = "force-dynamic";

export default async function AdminMaintenancePage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <TDashboardFeed
      title="Maintenance"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Maintenance" },
      ]}
      feed={<ImageMetadataJobTrigger />}
    />
  );
}
