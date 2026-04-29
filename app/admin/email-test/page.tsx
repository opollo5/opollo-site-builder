import { notFound, redirect } from "next/navigation";

import { EmailTestForm } from "@/components/EmailTestForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";

// AUTH-FOUNDATION P1.2 — /admin/email-test.
//
// Dev-only diagnostic surface for the SendGrid wrapper. Operator can
// fire a one-shot send through the same code path the runtime uses
// (lib/email/sendgrid.ts) without dropping to the CLI. Phase 3 will
// replace the NODE_ENV gate with a super_admin role check.
//
// Defence in depth:
//   1. NODE_ENV gate fronts the page (notFound in prod).
//   2. Admin auth gate behind it (admin OR operator role).
//   3. The API route /api/admin/email-test re-checks NODE_ENV and
//      auth so a route-level fetch from a logged-in admin in prod
//      still 404s.

export const dynamic = "force-dynamic";

export default async function EmailTestPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <div className="mx-auto max-w-2xl">
      <H1>SendGrid wrapper test</H1>
      <Lead className="mt-1">
        Fire a one-shot test email through{" "}
        <code className="font-mono text-sm">lib/email/sendgrid.ts</code>. Same
        code path as the runtime uses — invites, login challenges, every
        transactional send.
      </Lead>

      <Alert className="mt-6">
        Dev-only surface, gated on{" "}
        <code className="font-mono text-xs">NODE_ENV !== &quot;production&quot;</code>.
        Phase 3 replaces this with a super_admin role check.
      </Alert>

      <div className="mt-6">
        <EmailTestForm />
      </div>
    </div>
  );
}
