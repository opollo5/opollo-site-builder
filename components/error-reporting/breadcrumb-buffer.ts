// ---------------------------------------------------------------------------
// Breadcrumb ring buffer — singleton, client-side only.
//
// Tracks user actions for the last 5 minutes (max 200 entries). BreadcrumbProvider
// initialises and tears down the listeners; this module is the data store.
//
// Privacy rules (hard):
//   - Click events: element selector + visible text label only. Never input values.
//   - Network requests: method, URL (scrubbed), status, duration. Never bodies.
//   - Form submits: form element selector + field names only. Never field values.
//   - Console: message string truncated to 500 chars. No stack attached here.
// ---------------------------------------------------------------------------

import type { BreadcrumbEntry, BreadcrumbType, RouteChange } from "@/lib/error-reporting/types";
import { scrubUrl } from "@/lib/error-reporting/scrubber";

const MAX_ENTRIES = 200;
const MAX_AGE_MS = 5 * 60 * 1000;

const entries: BreadcrumbEntry[] = [];
const routeHistory: RouteChange[] = [];
let previousRoute = "";

function push(type: BreadcrumbType, data: Record<string, unknown>): void {
  const entry: BreadcrumbEntry = { ts: new Date().toISOString(), type, data };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

function fresh(): BreadcrumbEntry[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return entries.filter((e) => new Date(e.ts).getTime() > cutoff);
}

/** Called by BreadcrumbProvider on every pathname change. */
export function trackRoute(to: string): void {
  const from = previousRoute;
  previousRoute = to;
  if (from === to) return;
  const change: RouteChange = { ts: new Date().toISOString(), from, to };
  routeHistory.push(change);
  if (routeHistory.length > 50) routeHistory.shift();
  push("route", { from, to });
}

/** Returns the last 10 route changes. */
export function getRouteHistory(): RouteChange[] {
  return routeHistory.slice(-10);
}

/** Returns breadcrumbs from the last 5 minutes, newest-first. */
export function getBreadcrumbs(): BreadcrumbEntry[] {
  return fresh().reverse();
}

/** Clears all data — called on logout. */
export function clearBreadcrumbs(): void {
  entries.length = 0;
  routeHistory.length = 0;
  previousRoute = "";
}

export function trackClick(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const el = target.closest("button, a, [role=button], [role=menuitem]");
  if (!el) return;
  const label =
    (el instanceof HTMLElement ? el.innerText?.trim().slice(0, 100) : null) ??
    el.getAttribute("aria-label") ??
    el.getAttribute("data-testid") ??
    el.tagName.toLowerCase();
  const selector = buildSelector(el);
  push("click", { selector, label });
}

export function trackNetworkRequest(
  method: string,
  url: string,
  status: number,
  durationMs: number,
): void {
  push("network", { method, url: scrubUrl(url), status, durationMs });
}

export function trackFormSubmit(form: HTMLFormElement): void {
  const selector = buildSelector(form);
  const fieldNames = Array.from(form.elements)
    .filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      "name" in el && !!(el as HTMLInputElement).name,
    )
    .map((el) => (el as HTMLInputElement).name)
    .filter(Boolean)
    .slice(0, 30);
  push("form_submit", { selector, fieldNames });
}

export function trackConsole(level: "console_error" | "console_warn", msg: string): void {
  push(level, { message: msg.slice(0, 500) });
}

export function trackErrorToast(message: string): void {
  push("error_toast", { message: message.slice(0, 200) });
}

function buildSelector(el: Element): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  const id = el.getAttribute("id");
  if (id) parts.push(`#${id}`);
  const testId = el.getAttribute("data-testid");
  if (testId) parts.push(`[data-testid="${testId}"]`);
  return parts.join("");
}

/** Exposed for tests. */
export function __resetBufferForTests(): void {
  entries.length = 0;
  routeHistory.length = 0;
  previousRoute = "";
}
