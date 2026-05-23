import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface ActivityEntry {
  operatorUserId: string;
  clientCompanyId: string;
  action: string;
  occurredAt: string;
}

interface RecentAdminActivityProps {
  activity: ActivityEntry[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ACTION_LABELS: Record<string, string> = {
  view: "viewed",
  dismiss: "dismissed a rec for",
  annotate: "annotated a rec for",
  unsuppress: "un-suppressed a rec for",
  export: "exported data for",
  override: "overrode a rec for",
};

export function RecentAdminActivity({ activity }: RecentAdminActivityProps) {
  if (activity.length === 0) return null;

  return (
    <Card className="border-b2" data-testid="recent-admin-activity">
      <CardHeader className="pb-3">
        <h2 className="text-section-title text-tx-primary">Recent admin activity</h2>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {activity.map((entry, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-tx-secondary">
              <span className="text-tx-muted shrink-0">{relativeTime(entry.occurredAt)}</span>
              <span className="text-tx-muted">·</span>
              <span>
                {ACTION_LABELS[entry.action] ?? entry.action} client{" "}
                <span className="font-medium text-tx-primary">{entry.clientCompanyId.slice(0, 8)}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
