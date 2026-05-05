import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Opollo button hierarchy — all variants are full-pill (rounded-full).
// default  → pink gradient CTA (uppercase 16px 700)
// outline  → hairline border, goes green on hover
// ghost    → transparent, green on hover (nav / table actions)
// secondary → subtle elevated surface
// destructive → red, for irreversible actions
// link    → pink underline
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium ring-offset-background transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-pk to-pk2 text-white text-base font-bold uppercase tracking-[0.05em] hover:brightness-110 hover:-translate-y-px hover:shadow-[0_4px_24px_rgba(255,3,165,0.40)] active:translate-y-0 active:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:translate-y-px",
        outline:
          "border border-white/20 bg-transparent text-foreground hover:border-gr hover:text-gr active:translate-y-px",
        secondary:
          "bg-white/[0.08] text-foreground hover:bg-white/[0.12] active:translate-y-px",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-[rgba(0,229,160,0.08)] hover:text-gr",
        link: "text-pk underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-8 px-4 text-sm",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
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
