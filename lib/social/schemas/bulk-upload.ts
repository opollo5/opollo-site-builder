import { z } from "zod";

// Canonical CSV format per API_CONTRACTS.md §3.
// Content, Date (MM/DD/YYYY), Time (HH:MM 24h), Channel (pipe-separated|optional)

export const BulkRowSchema = z.object({
  content: z.string().min(1).max(63206),
  // MM/DD/YYYY — validated and converted to ISO by the parser
  date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Date must be MM/DD/YYYY"),
  // HH:MM 24-hour
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM (24-hour)"),
  // Optional pipe-separated channel list; empty string = all connected
  channel: z.string().default(""),
});

export type BulkRowInput = z.infer<typeof BulkRowSchema>;

export interface BulkValidationError {
  row: number; // 1-indexed (1 = first data row)
  column: "Content" | "Date" | "Time" | "Channel";
  message: string;
}

export interface BulkUploadResult {
  batch_id: string;
  count: number;
  warnings?: Array<{ row: number; message: string }>;
}
