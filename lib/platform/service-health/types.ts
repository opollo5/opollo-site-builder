import "server-only";

export type EventType =
  | "service_5xx"
  | "connection_failure"
  | "auth_failure"
  | "billing_failure"
  | "rate_limit"
  | "webhook_auth_failure"
  | "cron_stale"
  | "recovered"
  | "manual_flag"
  | "cost_cap_exceeded"
  | "missing_voice_profile";

export type Severity = "info" | "warning" | "critical";

export interface ServiceHealthEvent {
  id: string;
  service_name: string;
  operation: string | null;
  event_type: EventType;
  severity: Severity;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  details: Record<string, unknown>;
  raised_by_user_id: string | null;
}

export interface RecordEventInput {
  serviceName: string;
  operation?: string;
  eventType: EventType;
  severity: Severity;
  details?: Record<string, unknown>;
}
