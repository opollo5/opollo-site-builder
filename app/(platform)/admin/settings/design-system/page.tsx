import { redirect } from "next/navigation";

import { DesignSystemSettingsClient } from "@/components/DesignSystemSettingsClient";
import { PageHeader } from "@/components/ui/page-header";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function DesignSystemSettingsPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin"],
    insufficientRoleRedirectTo: "/admin",
  });
  if (access.kind === "redirect") redirect(access.to);

  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("design_system_settings")
    .select("*")
    .is("company_id", null)
    .maybeSingle();

  return (
    <>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Settings" },
            { label: "Design system" },
          ]}
        />
        <PageHeader.Title>Design system settings</PageHeader.Title>
        <PageHeader.Subtitle>
          Override design tokens globally. Changes inject CSS variables at the
          root layout level — all operator surfaces update immediately after
          save.
        </PageHeader.Subtitle>
      </PageHeader>
      <DesignSystemSettingsClient initialSettings={data ?? null} />
    </>
  );
}
