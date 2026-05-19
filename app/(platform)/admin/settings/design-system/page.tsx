import { redirect } from "next/navigation";

import { DesignSystemSettingsClient } from "@/components/DesignSystemSettingsClient";
import { TSettingsFlat } from "@/templates";
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
    <TSettingsFlat
      title="Design system settings"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Settings" },
        { label: "Design system" },
      ]}
      subtitle="Override design tokens globally. Changes inject CSS variables at the root layout level — all operator surfaces update immediately after save."
      sections={[{
        title: "Global tokens",
        content: <DesignSystemSettingsClient initialSettings={data ?? null} />,
      }]}
    />
  );
}
