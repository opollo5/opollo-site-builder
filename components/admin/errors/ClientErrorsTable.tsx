"use client";

import * as React from "react";
import { resolveClientError } from "@/app/(platform)/admin/errors/_actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ClientErrorRow {
  id: string;
  trace_id: string;
  company_id: string | null;
  surface: string;
  error_code: string;
  severity: string;
  message: string | null;
  context: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
}

const SEVERITY_CLASSES: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  error:    "bg-orange-50 text-orange-700 border-orange-200",
  warning:  "bg-amber-50 text-amber-700 border-amber-200",
  info:     "bg-muted text-muted-foreground border-border",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-xs font-medium",
        SEVERITY_CLASSES[severity] ?? SEVERITY_CLASSES.info,
      )}
    >
      {severity}
    </span>
  );
}

function ResolveButton({ id }: { id: string }) {
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    await resolveClientError(id);
    // Page re-renders via revalidatePath; if not, optimistic UI already hides the row.
    setPending(false);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => void handleClick()}
      data-testid={`resolve-error-${id}`}
    >
      {pending ? "Resolving…" : "Mark resolved"}
    </Button>
  );
}

export function ClientErrorsTable({ errors }: { errors: ClientErrorRow[] }) {
  return (
    <div className="overflow-x-auto" data-testid="client-errors-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">When</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Severity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Surface</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Code</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Message</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Trace</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody>
          {errors.map((err, i) => (
            <tr
              key={err.id}
              className={cn(
                "border-b border-border last:border-0 hover:bg-muted/20 transition-colors",
                i % 2 === 0 ? "bg-background" : "bg-muted/10",
              )}
              data-testid={`client-error-row-${err.id}`}
            >
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                {new Date(err.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <SeverityBadge severity={err.severity} />
              </td>
              <td className="px-4 py-3 font-mono text-xs">{err.surface}</td>
              <td className="px-4 py-3 font-mono text-xs">{err.error_code}</td>
              <td className="max-w-xs px-4 py-3 text-xs text-foreground">
                <span className="line-clamp-2">{err.message ?? "—"}</span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {err.trace_id}
              </td>
              <td className="px-4 py-3">
                <ResolveButton id={err.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
