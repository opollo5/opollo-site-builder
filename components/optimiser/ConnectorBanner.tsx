import Link from "next/link";

import type { ConnectorBanner } from "@/lib/optimiser/connector-status";
import { cn } from "@/lib/utils";

// §7.3 connector failure-resolution banner. Renders the
// (kind, severity, action) triple from connector-status.ts.

const SEVERITY_STYLES: Record<ConnectorBanner["severity"], string> = {
  info: "bg-blue-50 border-blue-200 text-blue-900",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
  error: "bg-red-50 border-red-200 text-red-900",
};

export function ConnectorBannerView({ banner }: { banner: ConnectorBanner }) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        SEVERITY_STYLES[banner.severity],
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{banner.title}</p>
          <p className="text-sm opacity-90">{banner.body}</p>
        </div>
        {banner.action_label && banner.action_href && (
          <Link
            href={banner.action_href}
            className="shrink-0 rounded-md border border-current bg-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/60"
          >
            {banner.action_label}
          </Link>
        )}
      </div>
    </div>
  );
}
