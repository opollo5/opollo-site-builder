"use client";

import { SuccessMoment } from "@/components/ui/success-moment";

// Spec 08 surface — first WordPress site ever connected.
//
// Renders at the top of /admin/sites/[id]/onboarding when arriving from
// SiteCreateForm with ?fresh=1. The page is the natural celebration
// moment: operator just connected WP credentials, they're seeing their
// site for the first time, and they're about to pick onboarding mode.
//
// firstTimeKey is device-scoped ('first-site-connected'), so the
// celebration fires once per device — subsequent sites get the
// existing toast.success("Site connected") on SiteCreateForm.

interface Props {
  siteName: string;
}

export function FirstSiteConnectedMoment({ siteName }: Props) {
  return (
    <SuccessMoment
      firstTimeKey="first-site-connected"
      title={`${siteName} is connected.`}
      firstTimeTitle={`${siteName} is connected. Nice — your first site.`}
      subtitle="Pick how you want to set it up below. You can change your mind later."
    />
  );
}
