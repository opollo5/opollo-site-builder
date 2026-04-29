import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-6 — Alert primitive.
//
// Extracts the inline alert pattern repeated across the codebase
// (`rounded-md border border-X/40 bg-X/10 p-3 text-sm text-X` for
// each of destructive / warning / success / info). CVA-driven so
// consumers pass `variant="warning"` and the icon, border, bg, and
// text colour resolve together.
//
// Always carries role="alert" (errors) or role="status" (info /
// success / warning). Default icon per variant; consumers can
// override via the `icon` prop.
// ---------------------------------------------------------------------------

const alertVariants = cva(
  "flex items-start gap-3 rounded-md border p-3 text-sm",
  {
    variants: {
      variant: {
        info: "border-info/40 bg-info/10 text-info",
        success: "border-success/40 bg-success/10 text-success",
        warning: "border-warning/40 bg-warning/10 text-warning",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

const VARIANT_ICON: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  LucideIcon
> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
};

const VARIANT_ROLE: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  "alert" | "status"
> = {
  info: "status",
  success: "status",
  warning: "status",
  destructive: "alert",
};

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  /** Override the default icon for this variant. */
  icon?: LucideIcon | null;
  /** Optional title — renders as a bolder line above the body. */
  title?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  function Alert(
    { className, variant, icon, title, children, role, ...props },
    ref,
  ) {
    const v = variant ?? "info";
    const Icon = icon === null ? null : (icon ?? VARIANT_ICON[v]);
    return (
      <div
        ref={ref}
        role={role ?? VARIANT_ROLE[v]}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {Icon && (
          <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <p className="font-medium leading-tight">{title}</p>
          )}
          <div className={cn(title && "mt-1")}>{children}</div>
        </div>
      </div>
    );
  },
);
