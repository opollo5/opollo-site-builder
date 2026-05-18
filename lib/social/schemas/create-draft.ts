import { z } from "zod";

const platformSchema = z.enum([
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "google_business_profile",
  "pinterest",
  "tiktok",
]);

// CLAUDE-ASSUMPTION: using z.record(z.string(), ...) rather than z.record(platformSchema, ...)
// so that .default({}) is valid (z.record with enum key requires all keys in default).
const platformVariantSchema = z.record(
  z.string(),
  z.object({
    content: z.string().max(63206).optional(),
    link: z.string().url().optional(),
    cta: z.string().max(100).optional(),
  }),
);

export const CreateDraftSchema = z.object({
  content: z.string().max(63206),
  media_urls: z.array(z.string().url()).default([]),
  target_profile_ids: z.array(z.string().uuid()),
  platform_variants: platformVariantSchema.default({}),
  mode: z.enum(["post_now", "schedule", "recurring", "draft"]),

  // mode === 'schedule'
  scheduled_at_list: z
    .array(z.string().datetime())
    .optional(),

  // mode === 'recurring'
  recurrence: z
    .object({
      rule: z.string().min(1),
      starting_at: z.string().datetime(),
      until: z.string().datetime().optional(),
    })
    .optional(),

  // mode === 'draft'
  planned_for_at: z.string().datetime().optional(),

  approval_required: z.boolean(),
  approver_user_id: z.string().uuid().optional(),
});

export type CreateDraftInput = z.infer<typeof CreateDraftSchema>;

export const UpdateDraftSchema = CreateDraftSchema.partial().extend({
  scheduled_at: z.string().datetime().optional(),
  cancel_recurrence: z.boolean().optional(),
});

export type UpdateDraftInput = z.infer<typeof UpdateDraftSchema>;
