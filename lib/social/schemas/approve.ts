import { z } from "zod";

export const ApproveSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  rejection_reason: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.decision === "rejected") {
    if (!val.rejection_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rejection_reason is required when decision is 'rejected'",
        path: ["rejection_reason"],
      });
      return;
    }
    const len = val.rejection_reason.length;
    if (len < 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rejection_reason must be at least 30 characters",
        path: ["rejection_reason"],
      });
    }
    if (len > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rejection_reason must be at most 500 characters",
        path: ["rejection_reason"],
      });
    }
  }
});

export type ApproveInput = z.infer<typeof ApproveSchema>;
