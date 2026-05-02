import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

// DESIGN-SYSTEM-OVERHAUL PR 14 — uniform "something went wrong"
// surface. Wherever an admin route has historically dumped a raw
// error code (`INTERNAL_ERROR`, `KADENCE_NOT_ACTIVE`, etc.) into the
// UI, render this instead. Three slots:
//
//   title       — plain-English summary, never a code.
//   description — what happened, why it matters, in one or two
//                 sentences.
//   action      — primary remedial click. A Link or onClick is fine;
//                 the component renders whatever the caller passes
//                 inside the <Button> wrapper.
//
// Everything is operator-visible. Codes still belong in the audit
// log — they are valuable for incident reconstruction — but they
// don't belong in the UI.

export interface ErrorFallbackProps {
  title: string;
  description: ReactNode;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  supportHref?: string;
  testId?: string;
}

export function ErrorFallback({
  title,
  description,
  action,
  supportHref = "https://opollo.com/contact",
  testId,
}: ErrorFallbackProps) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 p-5"
      role="alert"
      data-testid={testId ?? "error-fallback"}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
        />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-semibold">{title}</p>
          <div className="text-sm text-muted-foreground">{description}</div>
          {action && (
            <div className="pt-1">
              {action.href ? (
                <Button asChild size="sm">
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ) : (
                <Button size="sm" type="button" onClick={action.onClick}>
                  {action.label}
                </Button>
              )}
            </div>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            Still stuck?{" "}
            <a
              href={supportHref}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Contact support
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
