import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Opollo button hierarchy — all variants are full-pill (rounded-full), sentence case.
// default     → solid #00e5a0 primary CTA, white text
// secondary   → white surface with #1F2937 hairline border (outlined)
// ghost       → transparent tertiary, dark text
// destructive → solid red, white text, for irreversible actions
// outline     → hairline border (legacy, backwards compat)
// link        → pink underline (legacy, backwards compat)
// toolbar     → square-ish composer toolbar tool button; active state via aria-pressed
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-smooth focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-semibold hover:brightness-110 hover:-translate-y-px hover:shadow-pk-glow active:translate-y-0 active:shadow-none",
        destructive:
          "bg-[var(--btn-destructive-bg)] text-[var(--btn-destructive-text)] hover:bg-rd hover:-translate-y-px active:translate-y-0",
        outline:
          "border border-white/20 bg-transparent text-foreground hover:border-gr hover:text-gr active:translate-y-px",
        secondary:
          "bg-[var(--btn-secondary-bg)] border border-[var(--btn-secondary-border)] text-[var(--btn-secondary-text)] hover:bg-gray-50 hover:-translate-y-px active:translate-y-0",
        ghost:
          "bg-transparent text-[var(--btn-tertiary-text)] hover:bg-[var(--btn-tertiary-hover)] active:translate-y-px",
        link: "text-pk underline-offset-4 hover:underline",
        toolbar:
          "rounded-md gap-1.5 border border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground active:translate-y-px aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary",
      },
      size: {
        default: "py-[10px] px-5 text-sm",
        sm: "py-[6px] px-[14px] text-xs",
        xs: "py-1 px-2 text-xs",
        lg: "py-[14px] px-7 text-base",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
