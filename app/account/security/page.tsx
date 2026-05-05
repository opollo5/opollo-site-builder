import { redirect } from "next/navigation";

import { AccountSecurityForm } from "@/components/AccountSecurityForm";
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

  // Nested <main> would be invalid HTML — the /account layout already
  // owns the outer <main>. Use a section wrapper here instead.
  return (
    <section className="mx-auto flex max-w-md flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Account security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Change your password. Minimum 12 characters.
        </p>
      </div>
      <AccountSecurityForm userEmail={user.email} />
    </section>
  );
}
