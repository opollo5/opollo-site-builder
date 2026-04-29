import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type {
  OptCredentialSource,
  OptCredentialStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Connector status helpers. The §7.3 banner UX (and the ongoing
// dashboard surface) reads from these. Each banner type maps to a
// (source, status, last_error_code) triple.
// ---------------------------------------------------------------------------

export type ConnectorStatus = {
  source: OptCredentialSource;
  connected: boolean;
  status: OptCredentialStatus | "missing";
  external_account_id: string | null;
  external_account_label: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_synced_at: string | null;
  refresh_token_expires_at: string | null;
};

const ALL_SOURCES: OptCredentialSource[] = [
  "google_ads",
  "clarity",
  "ga4",
  "pagespeed",
];

export async function getConnectorStatus(
  clientId: string,
): Promise<ConnectorStatus[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_credentials")
    .select(
      "source, status, external_account_id, external_account_label, last_error_code, last_error_message, last_synced_at, refresh_token_expires_at",
    )
    .eq("client_id", clientId);
  if (error) throw new Error(`getConnectorStatus: ${error.message}`);

  const map = new Map<OptCredentialSource, ConnectorStatus>();
  for (const row of data ?? []) {
    const source = row.source as OptCredentialSource;
    map.set(source, {
      source,
      connected: row.status === "connected",
      status: row.status as OptCredentialStatus,
      external_account_id: row.external_account_id as string | null,
      external_account_label: row.external_account_label as string | null,
      last_error_code: row.last_error_code as string | null,
      last_error_message: row.last_error_message as string | null,
      last_synced_at: row.last_synced_at as string | null,
      refresh_token_expires_at:
        row.refresh_token_expires_at as string | null,
    });
  }
  return ALL_SOURCES.map(
    (source) =>
      map.get(source) ?? {
        source,
        connected: false,
        status: "missing",
        external_account_id: null,
        external_account_label: null,
        last_error_code: null,
        last_error_message: null,
        last_synced_at: null,
        refresh_token_expires_at: null,
      },
  );
}

/**
 * Map a (source, status, last_error_code) triple to a UI banner. Used
 * by ConnectorBanner.tsx and the onboarding step verifier.
 */
export type ConnectorBannerKind =
  | "ads_oauth_expired"
  | "clarity_not_installed"
  | "ga4_no_goals"
  | "ads_tracking_missing"
  | "llm_budget_exceeded"
  | "ok";

export type ConnectorBanner = {
  kind: ConnectorBannerKind;
  source: OptCredentialSource | "system";
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  /** What the staff action is (button label). */
  action_label?: string;
  /** Where the action button takes the user. Relative URL. */
  action_href?: string;
  dismissable: boolean;
};

export function bannerForConnector(
  status: ConnectorStatus,
  optClientId: string,
): ConnectorBanner | null {
  if (status.connected) return null;
  switch (status.source) {
    case "google_ads":
      if (status.status === "expired" || status.status === "missing") {
        return {
          kind: "ads_oauth_expired",
          source: "google_ads",
          severity: "error",
          title:
            status.status === "missing"
              ? "Google Ads not connected"
              : "Google Ads connection expired",
          body:
            status.status === "missing"
              ? "Connect a Google Ads account to start syncing campaigns and landing pages."
              : "Re-authenticate to resume daily Ads sync.",
          action_label:
            status.status === "missing" ? "Connect Google Ads" : "Re-connect",
          action_href: `/api/optimiser/oauth/ads/start?client_id=${optClientId}`,
          dismissable: false,
        };
      }
      return {
        kind: "ads_oauth_expired",
        source: "google_ads",
        severity: "warning",
        title: "Google Ads in unexpected state",
        body: status.last_error_message ?? "See connector settings.",
        dismissable: true,
      };
    case "clarity":
      if (status.status === "missing" || status.status === "misconfigured") {
        return {
          kind: "clarity_not_installed",
          source: "clarity",
          severity: "warning",
          title: "Clarity not detecting traffic",
          body:
            "Add the Clarity snippet to the site, then click Verify install. Until verified, behaviour metrics are unavailable.",
          action_label: "Verify install",
          action_href: `/optimiser/onboarding/${optClientId}?step=clarity`,
          dismissable: false,
        };
      }
      return null;
    case "ga4":
      if (status.status === "missing") {
        return {
          kind: "ga4_no_goals",
          source: "ga4",
          severity: "warning",
          title: "GA4 not connected",
          body:
            "Connect a GA4 property to enable session and engagement metrics.",
          action_label: "Connect GA4",
          action_href: `/api/optimiser/oauth/ga4/start?client_id=${optClientId}`,
          dismissable: false,
        };
      }
      if (status.last_error_code === "NO_GOALS") {
        return {
          kind: "ga4_no_goals",
          source: "ga4",
          severity: "info",
          title: "GA4 has no conversions configured",
          body:
            "Engine will use traffic and behaviour signals only until goals are added.",
          dismissable: true,
        };
      }
      return null;
    case "pagespeed":
      // PSI uses an Opollo-wide API key; per-client banner only fires
      // if PAGESPEED_API_KEY is genuinely missing — that's a system
      // banner, not a client banner.
      return null;
  }
}
