import * as React from "react";

import {
  Breadcrumb,
  type BreadcrumbProps,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

// Spec 02 §1.1 + Spec 04 (2026-05-08) — PageHeader compound component.
//
// Compound layout (visual order is enforced regardless of JSX order):
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Test Site 2                              [Run Batch]     │  Title row · Actions right-aligned, vertically centered
//   │   ↑ 20px gap                                              │
//   │ Admin › Sites › Test Site 2                              │  Breadcrumb (text-sm muted)
//   │   ↑ 8px gap (or 20px from title if breadcrumb absent)    │
//   │ Optional one-line description.                            │  Subtitle (text-base muted)
//   │   ↑ 12px gap                                              │
//   │ ● Active · https://test2... · Tested 2h ago             │  Meta row (text-sm muted, inline)
//   └──────────────────────────────────────────────────────────┘
//                       [32px gap to PageShell.Content]
//
// Slot order is enforced by render order in this component, not by JSX
// child position. Detection is via `displayName`, NOT reference equality:
// reference equality breaks under HMR, when subcomponents are wrapped in
// `forwardRef`/`memo`, and when modules are duplicated across bundles.
//
// Title presence is enforced as a runtime invariant in development
// only (console.error, never throws). The `headings-use-page-header`
// audit rule (Spec 02 PR 3) enforces presence at the build layer.
//
// Spec 04 amendment (2026-05-08): slot order reversed from
// Breadcrumb→Title→… to Title→Breadcrumb→…, and the rhythm spec
// (20/8/12/32 gaps) added. Title weight bumped 600→700 in
// app/globals.css. Consumer JSX is unchanged — slot identity
// (displayName) drives the order, not the JSX order.

const SLOT_NAMES = {
  Breadcrumb: "PageHeaderBreadcrumb",
  Title: "PageHeaderTitle",
  Subtitle: "PageHeaderSubtitle",
  Meta: "PageHeaderMeta",
  Actions: "PageHeaderActions",
} as const;

type SlotKey = keyof typeof SLOT_NAMES;

function unwrapFragments(children: React.ReactNode): React.ReactNode[] {
  // One level of unwrap so <><Title /></> works the same as a direct
  // child. Don't recursively unwrap deep fragments — that would let
  // unrelated nested layouts opt-in by accident.
  const out: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (
      React.isValidElement(child) &&
      child.type === React.Fragment
    ) {
      const fragChildren = (child.props as { children?: React.ReactNode })
        .children;
      React.Children.forEach(fragChildren, (c) => out.push(c));
    } else {
      out.push(child);
    }
  });
  return out;
}

function detectSlot(
  element: React.ReactElement,
): SlotKey | null {
  const name =
    typeof element.type === "string"
      ? null
      : (element.type as { displayName?: string; name?: string })
          .displayName ??
        (element.type as { displayName?: string; name?: string }).name ??
        null;
  if (!name) return null;
  for (const slot of Object.keys(SLOT_NAMES) as SlotKey[]) {
    if (SLOT_NAMES[slot] === name) return slot;
  }
  return null;
}

export function pickSlots(children: React.ReactNode): {
  slots: Partial<Record<SlotKey, React.ReactElement>>;
  duplicates: SlotKey[];
} {
  const slots: Partial<Record<SlotKey, React.ReactElement>> = {};
  const duplicates: SlotKey[] = [];
  for (const child of unwrapFragments(children)) {
    if (!React.isValidElement(child)) continue;
    const matchedSlot = detectSlot(child);
    if (!matchedSlot) continue;
    if (slots[matchedSlot]) {
      duplicates.push(matchedSlot);
      continue; // first wins
    }
    slots[matchedSlot] = child;
  }
  return { slots, duplicates };
}

export const PAGE_HEADER_SLOT_NAMES = SLOT_NAMES;

export interface PageHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function PageHeader({ children, className }: PageHeaderProps) {
  const { slots, duplicates } = pickSlots(children);

  if (process.env.NODE_ENV !== "production") {
    if (!slots.Title) {
      // eslint-disable-next-line no-console
      console.error(
        "[PageHeader] Title slot is missing. Every PageHeader needs a <PageHeader.Title>. Add one in the calling page.tsx.",
      );
    }
    for (const dup of duplicates) {
      // eslint-disable-next-line no-console
      console.warn(
        `[PageHeader] Multiple <PageHeader.${dup}> children — using the first; later instances are dropped.`,
      );
    }
  }

  // Rhythm gaps below the title row, conditional on which slots are
  // present so the rhythm collapses cleanly when slots are missing:
  //   first-rendered-slot-after-title → mt-5  (20px)
  //   subtitle when breadcrumb shown   → mt-2  (8px)
  //   meta when subtitle shown         → mt-3  (12px)
  //   meta when only breadcrumb shown  → mt-2  (8px)
  //   meta with neither breadcrumb nor subtitle → mt-5 (20px)
  const subtitleGap = slots.Breadcrumb ? "mt-2" : "mt-5";
  const metaGap = slots.Subtitle
    ? "mt-3"
    : slots.Breadcrumb
      ? "mt-2"
      : "mt-5";

  return (
    <header className={cn("mb-8", className)}>
      {/* Title row — Actions sit on the same horizontal axis, right-aligned,
          vertically centered with the title. flex-wrap so very long titles
          can push Actions onto a second row at narrow widths instead of
          clipping. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{slots.Title}</div>
        {slots.Actions && (
          <div className="flex shrink-0 items-center gap-2">
            {slots.Actions}
          </div>
        )}
      </div>

      {slots.Breadcrumb && <div className="mt-5">{slots.Breadcrumb}</div>}
      {slots.Subtitle && (
        <div className={subtitleGap}>{slots.Subtitle}</div>
      )}
      {slots.Meta && <div className={metaGap}>{slots.Meta}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents — each carries a stable displayName so PageHeader's slot
// matcher recognises them across HMR / bundling boundaries.
// ---------------------------------------------------------------------------

function PageHeaderBreadcrumb(props: BreadcrumbProps) {
  return <Breadcrumb {...props} />;
}
PageHeaderBreadcrumb.displayName = SLOT_NAMES.Breadcrumb;

function PageHeaderTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1 className={cn("text-xl text-page-title text-foreground", className)}>
      {children}
    </h1>
  );
}
PageHeaderTitle.displayName = SLOT_NAMES.Title;

function PageHeaderSubtitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-base text-muted-foreground", className)}>
      {children}
    </div>
  );
}
PageHeaderSubtitle.displayName = SLOT_NAMES.Subtitle;

function PageHeaderMeta({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
PageHeaderMeta.displayName = SLOT_NAMES.Meta;

function PageHeaderActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
PageHeaderActions.displayName = SLOT_NAMES.Actions;

PageHeader.Breadcrumb = PageHeaderBreadcrumb;
PageHeader.Title = PageHeaderTitle;
PageHeader.Subtitle = PageHeaderSubtitle;
PageHeader.Meta = PageHeaderMeta;
PageHeader.Actions = PageHeaderActions;
