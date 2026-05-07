import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// A-6 — Alert primitive.
//
// CVA-driven so consumers pass `variant="warning"` and the icon, border,
// bg, and text colour resolve together. Default icon per variant; pass
// `icon={null}` to suppress, or `icon={<NavIcon name="..." />}` to override.
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

const VARIANT_ICON_NAME: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  string
> = {
  info: "question-circle",
  success: "checkmark-circle",
  warning: "warning",
  destructive: "warning",
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
  /** Override the default icon for this variant. Pass `null` to suppress. */
  icon?: React.ReactNode | null;
  /** Optional title — renders as a bolder line above the body. */
  title?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  function Alert(
    { className, variant, icon, title, children, role, ...props },
    ref,
  ) {
    const v = variant ?? "info";
    const renderedIcon =
      icon === null
        ? null
        : icon !== undefined
          ? icon
          : (
              <NavIcon
                name={VARIANT_ICON_NAME[v]}
                size={16}
                className="mt-0.5 shrink-0"
              />
            );
    return (
      <div
        ref={ref}
        role={role ?? VARIANT_ROLE[v]}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {renderedIcon}
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
