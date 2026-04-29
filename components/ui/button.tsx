import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// R1-4 — Linear-style button hierarchy. Primary feels primary; outline
// reads as a real secondary; ghost is subtle but lights up on hover.
//
// Changes from B-2:
//   • default: shadow-sm + active:translate-y-px gives a tactile press;
//     hover lifts to shadow.
//   • outline: border-input bumped to a tone the eye registers against
//     bg-background OR bg-canvas; hover drops a subtle muted bg under
//     the border instead of swapping accent (which competed with primary
//     visually).
//   • secondary: bg-secondary darkened via the --secondary token
//     adjustment in globals.css; readable against canvas + cards both.
//   • ghost: explicit bg-transparent + hover:bg-muted (was hover:bg-
//     accent which renders the same as muted under the current
//     palette but is semantically clearer).
//
// `gap-2` from B-2 stays — supports icon + text composition.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow active:translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow active:translate-y-px",
        outline:
          "border border-input bg-background text-foreground shadow-sm hover:bg-muted/60 hover:border-foreground/20 active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:translate-y-px",
        ghost:
          "bg-transparent text-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-6",
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
