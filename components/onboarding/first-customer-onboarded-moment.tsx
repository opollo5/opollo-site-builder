"use client";

import { SuccessMoment } from "@/components/ui/success-moment";

// Spec 08 surface — first customer/company created.
//
// Renders at the top of /admin/companies when arriving from the create
// form with ?created=<id>. Per-customer firstTimeKey so the celebration
// fires exactly once per company and never re-fires on subsequent visits.

interface Props {
  companyId: string;
  companyName: string;
}

export function FirstCustomerOnboardedMoment({
  companyId,
  companyName,
}: Props) {
  return (
    <SuccessMoment
      firstTimeKey={`customer-onboarded:${companyId}`}
      title={`${companyName} is set up.`}
      firstTimeTitle={`${companyName} is set up. Nice — your first customer.`}
      subtitle="You can invite users, configure social platforms, and start creating content from the new company's surfaces."
    />
  );
}
