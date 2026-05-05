import { redirect } from "next/navigation";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { DesignSystemSettingsClient } from "@/components/DesignSystemSettingsClient";

export const dynamic = "force-dynamic";

export default async function DesignSystemSettingsPage() {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);
  if (!access.user || access.user.role !== "super_admin") {
    redirect("/admin/sites");
  }

  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("design_system_settings")
    .select("*")
    .is("company_id", null)
    .maybeSingle();

  return <DesignSystemSettingsClient initialSettings={data} />;
}
