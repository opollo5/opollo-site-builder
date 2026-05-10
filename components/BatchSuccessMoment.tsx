"use client";

import { SuccessMoment } from "@/components/ui/success-moment";

// Spec 08 — batch-completion success moment.
//
// Client component so SuccessMoment can read localStorage (firstTimeKey).
// Rendered by the batch detail server page when job.status === "succeeded".

interface Props {
  jobId: string;
  succeededCount: number;
  siteName: string;
  siteId: string;
}

export function BatchSuccessMoment({ jobId, succeededCount, siteName, siteId }: Props) {
  return (
    <SuccessMoment
      firstTimeKey={`batch-completed:${jobId}`}
      title="Batch complete"
      firstTimeTitle="Batch completed!"
      subtitle={`${succeededCount} page${succeededCount === 1 ? "" : "s"} generated for ${siteName}.`}
      primaryAction={{ label: "View batches", href: `/admin/batches/${siteId}` }}
    />
  );
}
