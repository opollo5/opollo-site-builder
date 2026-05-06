import { redirect } from "next/navigation";

import { DesignSystemSettingsClient } from "@/components/DesignSystemSettingsClient";
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

  return <DesignSystemSettingsClient initialSettings={data ?? null} />;
}
