import { z } from "zod";

// ---------------------------------------------------------------------------
// S1-17 — bundle.social webhook event shapes.
//
// bundle.social's webhook docs describe events with at least:
//   id            — unique per delivery (used for idempotency)
//   type          — dot-namespaced event identifier
//   data          — event-specific payload
//
// We're permissive about the shape because their schema isn't fully
// pinned in versioned docs; we only require the discriminator + an
// id, and let `data` be a passthrough JSON object that each handler
// destructures with its own zod schema.
//
// V1 supported types:
//   post.published        — a scheduled post landed on the platform.
//   post.failed           — a scheduled post errored out at the platform.
//   social-account.disconnected — a connection lost auth (user revoked, expired).
//   social-account.auth-required — bundle.social can't refresh the token.
//
// Anything else: stored in social_webhook_events but no side-effect
// processing. Returns 200 so bundle.social doesn't retry.
// ---------------------------------------------------------------------------

export const WebhookEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

// post.* events identify the bundle.social post by id, optionally with
// the resulting platform URL.
export const PostEventDataSchema = z
  .object({
    postId: z.string().min(1).optional(),
    bundlePostId: z.string().min(1).optional(),
    platformPostUrl: z.string().url().optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        class: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type PostEventData = z.infer<typeof PostEventDataSchema>;

// social-account.* events identify a connection by its bundle.social
// account id (the one we stored in social_connections.bundle_social_account_id).
export const AccountEventDataSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    socialAccountId: z.string().min(1).optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export type AccountEventData = z.infer<typeof AccountEventDataSchema>;

// Map bundle.social's free-form error.class strings to our enum.
// Anything unknown lands in 'unknown' so the row still validates.
export type SocialErrorClass =
  | "network"
  | "rate_limit"
  | "platform_error"
  | "auth"
  | "content_rejected"
  | "media_invalid"
  | "unknown";

const ERROR_CLASS_MAP: Record<string, SocialErrorClass> = {
  network: "network",
  timeout: "network",
  rate_limit: "rate_limit",
  rate_limited: "rate_limit",
  throttle: "rate_limit",
  platform_error: "platform_error",
  api_error: "platform_error",
  auth: "auth",
  unauthorized: "auth",
  token_expired: "auth",
  content_rejected: "content_rejected",
  policy_violation: "content_rejected",
  rejected: "content_rejected",
  media_invalid: "media_invalid",
  invalid_media: "media_invalid",
};

export function mapErrorClass(raw: string | null | undefined): SocialErrorClass {
  if (!raw) return "unknown";
  return ERROR_CLASS_MAP[raw.toLowerCase()] ?? "unknown";
}
