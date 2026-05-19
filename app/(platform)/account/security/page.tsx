import { redirect } from "next/navigation";

import { AccountSecurityForm } from "@/components/AccountSecurityForm";
import { TSettingsFlat } from "@/templates";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// /account/security — M14-4.
//
// Session-gated change-password surface for a signed-in user. No role
// check — every authenticated user can change their own password
// (admin, operator, viewer alike).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    redirect("/login?next=%2Faccount%2Fsecurity");
  }
  if (!user.email) {
    // Every opollo_users row has an email by schema, but the type allows
    // null. If we ever hit this in prod, fail visibly — silent success
    // here would let the form submit against an account that can't be
    // verified.
    redirect("/login");
  }

  return (
    <TSettingsFlat
      title="Account security"
      breadcrumb={[
        { label: "Account", href: "/account/security" },
        { label: "Security" },
      ]}
      subtitle="Change your password. Minimum 12 characters."
      sections={[{
        title: "Password",
        content: <AccountSecurityForm userEmail={user.email} />,
      }]}
    />
  );
}
