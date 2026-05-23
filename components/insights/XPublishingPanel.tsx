import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

interface XPublishingPanelProps {
  metrics: InsightsDashboardData["xMetrics"];
}

export function XPublishingPanel({ metrics }: XPublishingPanelProps) {
  return (
    <CardContent className="pt-6" data-testid="x-publishing-panel">
      <Alert
        variant="warning"
        title="X analytics aren't available through our data provider"
        className="mb-4"
      >
        View engagement directly in X&apos;s own dashboard.{" "}
        <Button variant="link" asChild className="h-auto p-0 text-sm">
          <a
            href="https://analytics.twitter.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open X Analytics ↗
          </a>
        </Button>
      </Alert>
      {metrics && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm uppercase text-tx-muted">Published last 30 days</div>
            <div className="text-2xl font-semibold tabular-nums text-tx-primary">
              {metrics.published30d}
            </div>
          </div>
          <div>
            <div className="text-sm uppercase text-tx-muted">Scheduled</div>
            <div className="text-2xl font-semibold tabular-nums text-tx-primary">
              {metrics.scheduled}
            </div>
          </div>
        </div>
      )}
    </CardContent>
  );
}
