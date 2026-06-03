import { redirect } from "next/navigation";

import { checkAdminAccess } from "@/lib/admin-gate";
import { renderBaseEmail } from "@/lib/email/templates/base";

// ---------------------------------------------------------------------------
// Dev email preview — /admin/email-preview/[template]
//
// Staff-only. Renders the branded email shell with sample data so the
// brand shell can be visually inspected without sending an actual email.
// Cross-client pixel QA (Litmus) is out of scope for v1.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const SAMPLES: Record<string, Parameters<typeof renderBaseEmail>[0]> = {
  ticket_created: {
    preheader: "A new bug report has been submitted — review it now.",
    heading: "New bug report: Hero CTA not clickable on mobile",
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">A new bug report has been submitted. Review it in the admin feedback board.</p>`,
    bodyText: "A new bug report has been submitted. Review it in the admin feedback board.",
    cta: { label: "Review bug report", url: "#" },
    footerNote: "Sent automatically by Opollo.",
  },
  ticket_created_blocker: {
    preheader: "BLOCKER severity bug reported — immediate attention required.",
    heading: "🚨 BLOCKER bug reported: Checkout flow crashes on iPad",
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">A BLOCKER severity bug was just reported. Immediate attention required.</p>`,
    bodyText: "A BLOCKER severity bug was just reported. Immediate attention required.",
    cta: { label: "Review bug report", url: "#" },
    footerNote: "Sent automatically by Opollo.",
  },
  ticket_comment_staff: {
    preheader: "The Opollo team replied to your bug report.",
    heading: "Update on your bug report: Hero CTA not clickable on mobile",
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">The Opollo team has replied to your bug report.</p>`,
    bodyText: "The Opollo team has replied to your bug report.",
    cta: { label: "View conversation", url: "#" },
    footerNote: "Sent automatically by Opollo.",
  },
  invitation: {
    preheader: "You have been invited to join Opollo.",
    heading: "You've been invited to Opollo",
    bodyHtml: `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">You've been invited to join a company on Opollo. The button below sets your password and creates your account.</p>`,
    bodyText: "You've been invited to join a company on Opollo.",
    cta: { label: "Accept invitation", url: "#" },
    footerNote: "Sent automatically by Opollo.",
  },
};

export default async function EmailPreviewPage({
  params,
}: {
  params: Promise<{ template: string }>;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const { template } = await params;
  const sample = SAMPLES[template];

  if (!sample) {
    const available = Object.keys(SAMPLES).join(", ");
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Email preview — template not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          Available: <code>{available}</code>
        </p>
      </div>
    );
  }

  const { html } = renderBaseEmail(sample);

  return (
    <div className="bg-gray-100 p-4">
      <div className="mb-4 flex items-center gap-4">
        <h1 className="text-sm font-semibold text-gray-700">
          Email preview: <code>{template}</code>
        </h1>
        <span className="text-xs text-gray-400">Staff-only dev tool</span>
      </div>
      {/* Render the HTML as an iframe so email CSS is isolated */}
      <iframe
        srcDoc={html}
        className="h-[800px] w-full max-w-[680px] rounded border border-gray-200 bg-white"
        title={`Email preview: ${template}`}
      />
    </div>
  );
}
