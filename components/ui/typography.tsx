import * as React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-1 — Typography primitives.
//
// Five components cover every text role on an admin surface:
//
//   <H1>      page heading             text-xl font-semibold     ~20px
//   <H2>      section heading          text-base font-semibold   ~16px
//   <H3>      sub-section / card title text-sm font-semibold     ~14px
//   <Eyebrow> small uppercase label    text-sm font-medium       ~14px
//                                      uppercase tracking-wide
//   <Lead>    intro / context line     text-base                 ~16px
//                                      text-muted-foreground
//
// Why these tiers (Linear / Vercel / Stripe alignment):
//
//   • Page headings on operator surfaces sit at 20px — Linear's issue
//     view, Vercel's deployment header, Stripe's payment detail. 24px+
//     reads as marketing-page energy and pushes the rest of the page
//     below the fold.
//   • Section headings step down to 16px so they read as "structural
//     anchor" rather than "second-page heading".
//   • Sub-section / card titles sit at 14px because cards already use
//     14px body — the title stays in the same optical line height.
//   • Eyebrow + Lead are paired companions to H1 (eyebrow above as a
//     category label; lead below as a one-line context sentence).
//
// All five forward `ref` and any HTML element props so they remain
// drop-in for inline ARIA attributes (aria-labelledby targets, etc.).
//
// Sweep notes for follow-up Phase B PRs:
//
//   • <h1 className="text-xl font-semibold"> → <H1>
//   • <h2 className="text-sm font-semibold"> → <H3>   (semantic mismatch
//     but visual match — section headings in the sidebar are a sub-
//     section role despite the h2 element)
//   • <h2 className="text-base font-medium">  → <H2>
//   • <p className="text-sm text-muted-foreground"> beneath a heading
//     → <Lead>
//   • <span className="text-sm font-medium uppercase tracking-wide
//     text-muted-foreground"> → <Eyebrow>
//
// A-1 sweeps the page-heading <h1> pattern. Per-screen <h2> + Lead +
// Eyebrow folds happen in the matching Phase B PRs (per-screen polish
// is allowed to consume Phase A primitives but A-1 doesn't try to
// rewrite every section heading at once).
// ---------------------------------------------------------------------------

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;

export const H1 = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  function H1({ className, ...props }, ref) {
    return (
      <h1
        ref={ref}
        className={cn(
          "text-xl font-semibold tracking-tight text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

export const H2 = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  function H2({ className, ...props }, ref) {
    return (
      <h2
        ref={ref}
        className={cn(
          "text-base font-semibold tracking-tight text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

export const H3 = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  function H3({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn("text-sm font-semibold text-foreground", className)}
        {...props}
      />
    );
  },
);

type SpanProps = React.HTMLAttributes<HTMLSpanElement>;

export const Eyebrow = React.forwardRef<HTMLSpanElement, SpanProps>(
  function Eyebrow({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(
          "text-sm font-medium uppercase tracking-wide text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

type ParagraphProps = React.HTMLAttributes<HTMLParagraphElement>;

export const Lead = React.forwardRef<HTMLParagraphElement, ParagraphProps>(
  function Lead({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        className={cn("text-base text-muted-foreground", className)}
        {...props}
      />
    );
  },
);
