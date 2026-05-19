import { redirect } from "next/navigation";

import { EmailTestForm } from "@/components/EmailTestForm";
import { Alert } from "@/components/ui/alert";
import { TForm } from "@/templates";
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
    <TForm
      title="SendGrid wrapper test"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Email test" },
      ]}
      subtitle="Fire a one-shot test email through lib/email/sendgrid.ts. Same code path as the runtime uses — invites, login challenges, every transactional send."
      inlineAlert={
        <Alert>
          Restricted to <strong>super_admin</strong>. Every send is
          captured in <code className="font-mono text-sm">email_log</code>{" "}
          for audit.
        </Alert>
      }
      formSections={[{ content: <EmailTestForm /> }]}
    />
  );
}
