import { z } from "zod";

export const TEMPLATE_TYPES = [
  "homepage",
  "integration",
  "troubleshooting",
  "problem_led",
  "use_case",
  "seo_landing",
  "blog",
  "legal",
  "generic",
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;

export const CreatePageInputSchema = z.object({
  title: z.string().min(3).max(160),
  slug: z.string().regex(slugPattern).max(100),
  content: z.string().min(200),
  meta_description: z.string().min(50).max(160),
  parent_slug: z.string().regex(slugPattern).optional(),
  template_type: z.enum(TEMPLATE_TYPES),
  ds_version: z.string().regex(semverPattern),
});

export type CreatePageInput = z.infer<typeof CreatePageInputSchema>;

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "WP_API_ERROR",
  "AUTH_FAILED",
  "UPSTREAM_BLOCKED",
  "RATE_LIMIT",
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ToolSuccess<T> = {
  ok: true;
  data: T;
  validation: { passed: true; checks: string[] };
  ds_version: string;
  timestamp: string;
};

export type ToolError = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
    suggested_action: string;
  };
  timestamp: string;
};

export type ToolResponse<T> = ToolSuccess<T> | ToolError;

export type CreatePageData = {
  page_id: number;
  preview_url: string;
  admin_url: string;
  slug: string;
  status: string;
};

export const createPageJsonSchema = {
  name: "create_page",
  description:
    "Create a new WordPress page as a draft. Content must be wrapped in the scoped container (div.ls-page.ls-page-{template_type}[data-ds-version]) and use only design system components. Returns page_id and preview_url.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", minLength: 3, maxLength: 160 },
      slug: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        maxLength: 100,
        description: "Kebab-case slug.",
      },
      content: {
        type: "string",
        minLength: 200,
        description: "Full HTML body wrapped in scoped container per HC-2.",
      },
      meta_description: { type: "string", minLength: 50, maxLength: 160 },
      parent_slug: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description: "Optional parent page slug.",
      },
      template_type: {
        type: "string",
        enum: [...TEMPLATE_TYPES],
      },
      ds_version: {
        type: "string",
        pattern: "^\\d+\\.\\d+\\.\\d+$",
        description: "Design system version this page was generated against.",
      },
    },
    required: [
      "title",
      "slug",
      "content",
      "meta_description",
      "template_type",
      "ds_version",
    ],
  },
};

export function errorCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "AUTH_FAILED":
      return 401;
    case "RATE_LIMIT":
      return 429;
    case "UPSTREAM_BLOCKED":
    case "WP_API_ERROR":
    case "NETWORK_ERROR":
      return 502;
    case "INTERNAL_ERROR":
      return 500;
  }
}
