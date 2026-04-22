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

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "CONFIRMATION_REQUIRED",
  "WP_API_ERROR",
  "AUTH_FAILED",
  "UPSTREAM_BLOCKED",
  "RATE_LIMIT",
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
  "NOT_FOUND",
  "PREFIX_TAKEN",
  "VERSION_CONFLICT",
  "UNIQUE_VIOLATION",
  "FK_VIOLATION",
  "IMAGE_IN_USE",
  "REGEN_ALREADY_IN_FLIGHT",
  "BUDGET_EXCEEDED",
  // M12-1 — briefs upload + parse + commit.
  "BRIEF_EMPTY",
  "BRIEF_TOO_LARGE",
  "BRIEF_UNSUPPORTED_TYPE",
  "BRIEF_PARSE_FAILED",
  "BRIEF_RUN_ALREADY_ACTIVE",
  "IDEMPOTENCY_KEY_CONFLICT",
  "ALREADY_EXISTS",
  "FORBIDDEN",
  "UNAUTHORIZED",
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

// Simpler envelope for system-level APIs (site registration, etc.) that
// don't produce design-system-versioned output.
export type ApiSuccess<T> = {
  ok: true;
  data: T;
  timestamp: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ToolError;

export function errorCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
    case "FK_VIOLATION":
    case "BRIEF_EMPTY":
      return 400;
    case "AUTH_FAILED":
    case "UNAUTHORIZED":
      return 401;
    case "CONFIRMATION_REQUIRED":
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "PREFIX_TAKEN":
    case "VERSION_CONFLICT":
    case "UNIQUE_VIOLATION":
    case "IMAGE_IN_USE":
    case "REGEN_ALREADY_IN_FLIGHT":
    case "BRIEF_RUN_ALREADY_ACTIVE":
    case "ALREADY_EXISTS":
      return 409;
    case "BRIEF_TOO_LARGE":
      return 413;
    case "BRIEF_UNSUPPORTED_TYPE":
      return 415;
    case "IDEMPOTENCY_KEY_CONFLICT":
    case "BRIEF_PARSE_FAILED":
      return 422;
    case "RATE_LIMIT":
    case "BUDGET_EXCEEDED":
      return 429;
    case "UPSTREAM_BLOCKED":
    case "WP_API_ERROR":
    case "NETWORK_ERROR":
      return 502;
    case "INTERNAL_ERROR":
      return 500;
  }
}

// ---------- site registration ----------

export const SitePrefixPattern = /^[a-z0-9]{2,4}$/;

export const RegisterSiteInputSchema = z.object({
  name: z.string().min(1).max(100),
  wp_url: z.string().url(),
  // Optional at the API boundary. lib/sites.createSite generates one
  // server-side from the site name when absent (M2d UX cleanup:
  // operators should not have to reason about CSS scoping prefixes).
  prefix: z.string().regex(SitePrefixPattern).optional(),
  wp_user: z.string().min(1).max(100),
  wp_app_password: z.string().min(8),
});
export type RegisterSiteInput = z.infer<typeof RegisterSiteInputSchema>;

export const UpdateSiteBasicsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  wp_url: z.string().url().optional(),
}).refine((p) => Object.keys(p).length > 0, {
  message: "At least one field must be provided.",
});
export type UpdateSiteBasicsInput = z.infer<typeof UpdateSiteBasicsSchema>;

export type SiteRecord = {
  id: string;
  name: string;
  wp_url: string;
  prefix: string;
  design_system_version: string;
  status: string;
  last_successful_operation_at: string | null;
  plugin_version: string | null;
  created_at: string;
  updated_at: string;
};

export type SiteListItem = {
  id: string;
  name: string;
  wp_url: string;
  prefix: string;
  status: string;
  last_successful_operation_at: string | null;
  updated_at: string;
};

// ---------- create_page ----------

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

// ---------- list_pages ----------

export const PAGE_STATUSES = ["draft", "publish", "any"] as const;
export type PageStatusFilter = (typeof PAGE_STATUSES)[number];

export const ListPagesInputSchema = z.object({
  status: z.enum(PAGE_STATUSES).optional(),
  parent_slug: z.string().regex(slugPattern).optional(),
  search: z.string().max(200).optional(),
});
export type ListPagesInput = z.infer<typeof ListPagesInputSchema>;

export type PageListItem = {
  page_id: number;
  title: string;
  slug: string;
  status: string;
  parent_id: number | null;
  modified_date: string;
};

export type ListPagesData = {
  pages: PageListItem[];
};

export const listPagesJsonSchema = {
  name: "list_pages",
  description:
    "List WordPress pages. Optional filters: status, parent_slug, search query. Returns summary metadata per page (id, title, slug, status, parent, modified date).",
  input_schema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: [...PAGE_STATUSES],
        description: "Filter by status. Default returns all statuses.",
      },
      parent_slug: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description: "Filter to direct children of a parent page slug.",
      },
      search: {
        type: "string",
        maxLength: 200,
        description: "Free-text search across title and content.",
      },
    },
    required: [],
  },
};

// ---------- get_page ----------

export const GetPageInputSchema = z.object({
  page_id: z.number().int().positive(),
});
export type GetPageInput = z.infer<typeof GetPageInputSchema>;

export type GetPageData = {
  page_id: number;
  title: string;
  slug: string;
  content: string;
  meta_description: string;
  status: string;
  parent_id: number | null;
  modified_date: string;
};

export const getPageJsonSchema = {
  name: "get_page",
  description:
    "Retrieve a single WordPress page by ID, including full HTML content and metadata.",
  input_schema: {
    type: "object" as const,
    properties: {
      page_id: { type: "integer", minimum: 1 },
    },
    required: ["page_id"],
  },
};

// ---------- update_page ----------

export const CHANGE_SCOPES = [
  "minor_edit",
  "section_replacement",
  "major_rewrite",
] as const;
export type ChangeScope = (typeof CHANGE_SCOPES)[number];

export const UpdatePageInputSchema = z
  .object({
    page_id: z.number().int().positive(),
    title: z.string().min(3).max(160).optional(),
    content: z.string().min(200).optional(),
    meta_description: z.string().min(50).max(160).optional(),
    change_scope: z.enum(CHANGE_SCOPES),
    user_confirmed: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.content !== undefined ||
      v.meta_description !== undefined,
    {
      message:
        "At least one of title, content, meta_description must be provided.",
      path: ["_"],
    },
  );
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;

export type UpdatePageData = {
  page_id: number;
  status: string;
  modified_date: string;
};

export const updatePageJsonSchema = {
  name: "update_page",
  description:
    "Update an existing WordPress page. change_scope is required. For change_scope=major_rewrite on a published page, user_confirmed must be true (HC-5).",
  input_schema: {
    type: "object" as const,
    properties: {
      page_id: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 3, maxLength: 160 },
      content: { type: "string", minLength: 200 },
      meta_description: { type: "string", minLength: 50, maxLength: 160 },
      change_scope: {
        type: "string",
        enum: [...CHANGE_SCOPES],
        description:
          "Declared scope of change. major_rewrite on published pages requires user_confirmed=true.",
      },
      user_confirmed: {
        type: "boolean",
        description:
          "Set true only when the user has explicitly confirmed a destructive update this turn.",
      },
    },
    required: ["page_id", "change_scope"],
  },
};

// ---------- publish_page ----------

export const PublishPageInputSchema = z.object({
  page_id: z.number().int().positive(),
});
export type PublishPageInput = z.infer<typeof PublishPageInputSchema>;

export type PublishPageData = {
  page_id: number;
  status: string;
  published_url: string;
};

export const publishPageJsonSchema = {
  name: "publish_page",
  description:
    "Change a page's status from draft to publish. Returns the live URL.",
  input_schema: {
    type: "object" as const,
    properties: {
      page_id: { type: "integer", minimum: 1 },
    },
    required: ["page_id"],
  },
};

// ---------- delete_page ----------

export const DeletePageInputSchema = z.object({
  page_id: z.number().int().positive(),
  user_confirmed: z.literal(true),
});
export type DeletePageInput = z.infer<typeof DeletePageInputSchema>;

export type DeletePageData = {
  page_id: number;
  status: "trash";
};

export const deletePageJsonSchema = {
  name: "delete_page",
  description:
    "Move a WordPress page to trash (soft delete). Requires user_confirmed=true per HC-5. Recoverable via the WP admin trash.",
  input_schema: {
    type: "object" as const,
    properties: {
      page_id: { type: "integer", minimum: 1 },
      user_confirmed: {
        type: "boolean",
        const: true,
        description: "Must be true — deletion requires explicit confirmation.",
      },
    },
    required: ["page_id", "user_confirmed"],
  },
};

// ---------- search_images ----------
//
// M4-6 — read-only tool surfacing the image library's FTS index + tag
// filter to the chat model. Bounded query (limit cap 50 + deleted_at
// filter) so the agent can't pathologically drag the DB. At least one
// of {query, tags} must be supplied; an unfiltered browse is intentionally
// not a tool — operators should use the future admin list view (M5/M6).

export const SEARCH_IMAGES_MAX_LIMIT = 50;
export const SEARCH_IMAGES_DEFAULT_LIMIT = 20;

export const SearchImagesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(60)).min(1).max(10).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_IMAGES_MAX_LIMIT)
      .optional(),
  })
  .refine((v) => v.query !== undefined || v.tags !== undefined, {
    message: "Supply at least one of `query` or `tags`.",
  });

export type SearchImagesInput = z.infer<typeof SearchImagesInputSchema>;

export type SearchImagesResultImage = {
  id: string;
  cloudflare_id: string | null;
  caption: string | null;
  alt_text: string | null;
  tags: string[];
  width_px: number | null;
  height_px: number | null;
};

export type SearchImagesData = {
  images: SearchImagesResultImage[];
};

export const searchImagesJsonSchema = {
  name: "search_images",
  description:
    "Search the image library by full-text caption query and/or tag set. Returns up to 50 matching images with their Cloudflare id, caption, alt_text, tags, and dimensions. At least one of `query` or `tags` must be supplied. Tag filtering is AND (every supplied tag must be present on the image).",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description:
          "Free-text search against image captions (weighted) and tags. English FTS.",
      },
      tags: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 60 },
        minItems: 1,
        maxItems: 10,
        description:
          "Tag set; every tag must be present on the image (AND semantics).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: SEARCH_IMAGES_MAX_LIMIT,
        description: `Max rows to return. Defaults to ${SEARCH_IMAGES_DEFAULT_LIMIT}; cap is ${SEARCH_IMAGES_MAX_LIMIT}.`,
      },
    },
    required: [],
  },
};
