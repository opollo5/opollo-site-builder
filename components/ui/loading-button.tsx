"use client";

import { Button, type ButtonProps } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { cn } from "@/lib/utils";

export interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
  /** Optional override for the in-flight label. If omitted, children are reused. */
  loadingText?: string;
}

// Spec 07 PR B — wraps Button with a synchronous loading affordance:
//   • spinner inside the button (not blocking — operator sees activity within 100ms)
//   • disabled while loading
//   • aria-busy for screen readers
//   • children (or loadingText) still rendered so the click target stays visible
//
// Pair with `useAsyncAction` (lib/hooks/use-async-action.ts) — that hook
// owns the timeout + dirty-state guard; this component is the visual half.
export function LoadingButton({
  loading = false,
  loadingText,
  disabled,
  children,
  className,
  ...rest
}: LoadingButtonProps) {
  return (
    <Button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(className)}
    >
      {loading ? (
        <>
          <NavIcon name="sync" size={14} className="animate-spin" aria-hidden />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
