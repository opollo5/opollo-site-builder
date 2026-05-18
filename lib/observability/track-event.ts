"use client";

// ---------------------------------------------------------------------------
// Spec 22 — client-side observability for the composer.
//
// Events are posted fire-and-forget to /api/internal/events.
// The endpoint is best-effort; failures are swallowed to never block the UI.
// Disabled when NEXT_PUBLIC_ANALYTICS_DISABLED=true (e.g. in Playwright).
// ---------------------------------------------------------------------------

export type ComposerEvent =
  | { name: "composer.opened"; props: { correlation_id: string; draft_id: string | null } }
  | { name: "composer.closed"; props: { correlation_id: string; draft_id: string | null; reason: "close_button" | "backdrop" | "escape" | "back_button" | "submit" } }
  | { name: "composer.draft.created"; props: { correlation_id: string; draft_id: string } }
  | { name: "composer.draft.loaded"; props: { correlation_id: string; draft_id: string } }
  | { name: "composer.draft.autosaved"; props: { correlation_id: string; draft_id: string } }
  | { name: "composer.submit.clicked"; props: { correlation_id: string; draft_id: string; mode: string; create_another: boolean } }
  | { name: "composer.submit.success"; props: { correlation_id: string; draft_id: string; post_id: string; state: string; scheduled: boolean } }
  | { name: "composer.submit.error"; props: { correlation_id: string; draft_id: string; error_code: string } }
  | { name: "composer.mode.changed"; props: { correlation_id: string; from: string; to: string } }
  | { name: "composer.ai_assist.triggered"; props: { correlation_id: string; draft_id: string; action: "replace" | "append" } }
  | { name: "composer.conflict.detected"; props: { correlation_id: string; draft_id: string } };

const disabled =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_ANALYTICS_DISABLED === "true";

export function trackEvent(event: ComposerEvent): void {
  if (disabled || typeof window === "undefined") return;
  // Fire-and-forget; never await or surface errors.
  void fetch("/api/internal/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: event.name, props: event.props, ts: Date.now() }),
    keepalive: true,
  }).catch(() => {/* swallow */});
}
