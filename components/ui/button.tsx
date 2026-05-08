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
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium ring-offset-background transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[#00e5a0] text-white font-semibold hover:brightness-110 hover:-translate-y-px hover:shadow-pk-glow active:translate-y-0 active:shadow-none",
        destructive:
          "bg-[var(--btn-destructive-bg)] text-[var(--btn-destructive-text)] hover:bg-[#b91c1c] hover:-translate-y-px active:translate-y-0",
        outline:
          "border border-white/20 bg-transparent text-foreground hover:border-gr hover:text-gr active:translate-y-px",
        secondary:
          "bg-white border border-[#1F2937] text-[#1F2937] hover:bg-gray-50 hover:-translate-y-px active:translate-y-0",
        ghost:
          "bg-transparent text-[#1F2937] hover:bg-[#F3F4F6] active:translate-y-px",
        link: "text-pk underline-offset-4 hover:underline",
      },
      size: {
        default: "py-[10px] px-5 text-[14px]",
        sm: "py-[6px] px-[14px] text-[13px]",
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
