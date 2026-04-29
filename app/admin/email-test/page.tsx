import { notFound, redirect } from "next/navigation";

import { EmailTestForm } from "@/components/EmailTestForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { isEmailTestAllowed } from "@/lib/email-test-gate";

// AUTH-FOUNDATION P1.2 + P1-FIX — /admin/email-test.
//
// Dev / staging diagnostic surface for the SendGrid wrapper. Operator
// can fire a one-shot send through the same code path the runtime uses
// (lib/email/sendgrid.ts) without dropping to the CLI. Phase 3 will
// replace the host-aware gate with a super_admin role check and the
// host check goes away.
//
// Defence in depth:
//   1. Host-aware gate fronts the page (notFound on the prod custom
//      domain; allowed on local dev, Vercel preview, and the staging
//      *.vercel.app alias).
//   2. Admin auth gate behind it (admin OR operator role).
//   3. The API route /api/admin/email-test re-checks the same gate so
//      a route-level fetch from a logged-in admin on the prod domain
//      still 404s.

export const dynamic = "force-dynamic";

export default async function EmailTestPage() {
  if (!isEmailTestAllowed()) notFound();

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
        Reachable on local dev + the staging{" "}
        <code className="font-mono text-xs">*.vercel.app</code> alias only.
        Blocked on production custom domains. Phase 3 replaces this
        host-aware gate with a super_admin role check.
      </Alert>

      <div className="mt-6">
        <EmailTestForm />
      </div>
    </div>
  );
}
