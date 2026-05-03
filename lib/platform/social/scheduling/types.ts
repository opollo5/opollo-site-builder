import type { SocialPlatform } from "@/lib/platform/social/variants/types";

export type ScheduleEntry = {
  id: string;
  post_variant_id: string;
  scheduled_at: string;
  qstash_message_id: string | null;
  scheduled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
};

// Read shape for the operator UI: includes the variant's platform so
// the table can render "LinkedIn — Tue 12 May 09:00" without joining
// in the client.
export type ScheduleEntryWithPlatform = ScheduleEntry & {
  platform: SocialPlatform;
};

export type CreateScheduleEntryInput = {
  postMasterId: string;
  companyId: string;
  platform: SocialPlatform;
  // ISO timestamp; must be in the future.
  scheduledAt: string;
  // The actor who scheduled (audit). Pass gate.userId from the route.
  scheduledBy: string | null;
};

export type ListScheduleEntriesInput = {
  postMasterId: string;
  companyId: string;
  // When true, include cancelled entries (default false).
  includeCancelled?: boolean;
};

export type CancelScheduleEntryInput = {
  entryId: string;
  companyId: string;
};
