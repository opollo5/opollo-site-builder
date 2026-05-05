import { redirect } from "next/navigation";

import { DesignSystemSettingsClient } from "@/components/DesignSystemSettingsClient";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getDesignSystemCssOverride } from "@/lib/design-system/get-override";
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
    .select(
      "color_pk,color_pk2,color_gr,color_gr2,color_bl,color_am,color_rd,color_d1,color_d2,color_d3,color_d4,color_bg,font_display,font_body,radius",
    )
    .is("company_id", null)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <H1>Design system settings</H1>
        <Lead>
          Override the global design tokens applied at layout render time.
          Leave a field blank to use the built-in default.
        </Lead>
      </div>
      <DesignSystemSettingsClient initial={data ?? null} />
    </div>
  );
}
