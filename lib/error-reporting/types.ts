export interface ApiCallContext {
  method: string;
  url: string;
  status: number;
  durationMs?: number;
  requestId?: string;
  responseBody?: string;
}

/** Caller-supplied error context — the minimum needed to show a report button. */
export interface ErrorContext {
  message: string;
  type?: string;
  stack?: string;
  componentStack?: string;
  apiCall?: ApiCallContext;
  dbErrorCode?: string;
  /** Only the slice of app state relevant to the current route. */
  stateSlice?: Record<string, unknown>;
}

export type BreadcrumbType =
  | "click"
  | "route"
  | "network"
  | "form_submit"
  | "console_error"
  | "console_warn"
  | "error_toast";

export interface BreadcrumbEntry {
  ts: string;
  type: BreadcrumbType;
  data: Record<string, unknown>;
}

export interface RouteChange {
  ts: string;
  from: string;
  to: string;
}

/** Full report payload sent to the backend and emailed to the admin. */
export interface ErrorReport {
  // Identity (server-verified from session; filled by the backend)
  userId?: string;
  userEmail?: string;
  userRole?: string;

  // Environment
  gitSha?: string;
  environment?: string;
  browser: string;
  viewport: string;
  locale: string;
  timezone: string;
  timestamp: string;

  // Location
  currentUrl: string;
  previousUrl?: string;
  routeHistory: RouteChange[];

  // The error
  errorMessage: string;
  errorType?: string;
  stack?: string;
  componentStack?: string;
  apiCall?: ApiCallContext;
  dbErrorCode?: string;

  // Breadcrumbs
  breadcrumbs: BreadcrumbEntry[];

  // Application state
  stateSlice?: Record<string, unknown>;

  // User-provided
  userDescription?: string;
}
