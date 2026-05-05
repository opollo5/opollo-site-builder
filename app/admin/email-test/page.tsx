import { redirect } from "next/navigation";

import { EmailTestForm } from "@/components/EmailTestForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";

// AUTH-FOUNDATION P3.4 — /admin/email-test now gated on super_admin.
//
// Replaces the temporary host-aware gate from P1-FIX. The role check
// is the proper trust boundary: hi@opollo.com (super_admin) can fire
// transactional sends from any host (staging OR prod). Other admins +
// users get a clean redirect to /admin/sites.

export const dynamic = "force-dynamic";

export default async function EmailTestPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <div className="mx-auto max-w-2xl">
      <H1>SendGrid wrapper test</H1>
      <Lead className="mt-1">
        Fire a one-shot test email through{" "}
        <code className="font-mono text-sm">lib/email/sendgrid.ts</code>.
        Same code path as the runtime uses — invites, login challenges,
        every transactional send.
      </Lead>

      <Alert className="mt-6">
        Restricted to <strong>super_admin</strong>. Every send is
        captured in <code className="font-mono text-sm">email_log</code>{" "}
        for audit.
      </Alert>

      <div className="mt-6">
        <EmailTestForm />
      </div>
    </div>
  );
}
