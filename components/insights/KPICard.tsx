import { TrendingUpIcon, TrendingDownIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";

interface KPICardProps {
  label: string;
  value: string;
  delta?: string | null;
  deltaPositive?: boolean;
  action?: React.ReactNode;
  "data-testid"?: string;
}

export function KPICard({
  label,
  value,
  delta,
  deltaPositive,
  action,
  "data-testid": testId,
}: KPICardProps) {
  return (
    <Card className="border-b2" data-testid={testId}>
      <CardHeader className="pb-2">
        <CardDescription className="text-sm uppercase tracking-wide text-tx-muted">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums text-tx-primary">
          {value}
        </div>
        {delta && (
          <div className="mt-1 flex items-center gap-1 text-sm text-tx-muted">
            {deltaPositive ? (
              <TrendingUpIcon className="h-4 w-4 text-pk" />
            ) : (
              <TrendingDownIcon className="h-4 w-4 text-rd" />
            )}
            <span className={deltaPositive ? "text-pk" : "text-rd"}>{delta}</span>
          </div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
