import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  bullets?: string[];
  "data-testid"?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  bullets,
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      data-testid={testId}
    >
      {icon && <div className="text-tx-muted">{icon}</div>}
      <div className="space-y-2">
        <p className="text-base font-semibold text-tx-primary">{title}</p>
        {description && <p className="text-sm text-tx-muted">{description}</p>}
      </div>
      {bullets && bullets.length > 0 && (
        <ul className="space-y-1 text-sm text-tx-muted">
          {bullets.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
