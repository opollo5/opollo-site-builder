// Post state → allowed actions matrix.
//
// Single source of truth for "what can a post in state X do?".
// Consumed by:
//   - components/social/composer/ComposerOverlay.tsx — read-only mode
//   - app/api/platform/social/drafts/[id]/route.ts (PATCH) — server guard
//
// State enum mirrors supabase/migrations/0132_planned_for_at.sql §CHECK.
// Action enum is a UX vocabulary; not every action maps to a single
// route — `edit` is the right to render the textarea + Save/Schedule
// CTAs; `delete_from_records` calls the same DELETE route as `delete`
// but is a separate verb because the user-facing copy differs (the
// published-post deletion only removes the Opollo row; the post stays
// live on the social platform).
//
// NEVER UNPUBLISH FROM THE EXTERNAL PLATFORM. `delete_from_records`
// must only remove the social_post_drafts row. Bundle.social has no
// unpublish API call wired up here and we don't want one.

export type PostState =
  | "draft"
  | "pending_approval"
  | "rejected"
  | "scheduled"
  | "recurring"
  | "paused"
  | "publishing"
  | "published"
  | "failed";

export type PostAction =
  | "edit"
  | "schedule"
  | "reschedule"
  | "save_draft"
  | "convert_to_draft"
  | "delete"
  | "view"
  | "view_on_platform"
  | "view_analytics"
  | "repost_as_new"
  | "delete_from_records"
  | "cancel_publish"
  | "retry_publish"
  | "approve"
  | "reject";

export const ALLOWED_ACTIONS: Record<PostState, readonly PostAction[]> = {
  draft: ["edit", "schedule", "save_draft", "delete"],
  pending_approval: ["view", "approve", "reject", "delete"],
  rejected: ["edit", "save_draft", "delete"],
  scheduled: ["edit", "reschedule", "convert_to_draft", "delete"],
  recurring: ["view", "convert_to_draft", "delete"],
  paused: ["view", "convert_to_draft", "delete"],
  publishing: ["view"],
  published: [
    "view",
    "view_on_platform",
    "view_analytics",
    "repost_as_new",
    "delete_from_records",
  ],
  failed: ["edit", "retry_publish", "save_draft", "delete"],
} as const;

export function canPerform(state: PostState, action: PostAction): boolean {
  return ALLOWED_ACTIONS[state].includes(action);
}

// True for states the composer should render in read-only mode
// (textarea not editable, no Schedule/Save CTAs).
export function isReadOnlyState(state: PostState): boolean {
  return !canPerform(state, "edit");
}

// True for states the server-side PATCH endpoint must reject as 422.
// Mutating these states is never legitimate from the composer write
// path — `published` is on the social platform; `publishing` is owned
// by the publish job. Transitions out of these states happen via
// dedicated endpoints (retry, repost-as-new), not generic PATCH.
export function isTerminalForMutation(state: PostState): boolean {
  return state === "published" || state === "publishing";
}
