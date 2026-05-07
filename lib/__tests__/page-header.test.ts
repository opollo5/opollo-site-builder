import * as React from "react";
import { describe, expect, it } from "vitest";

import {
  PageHeader,
  PAGE_HEADER_SLOT_NAMES,
  pickSlots,
} from "@/components/ui/page-header";

// Spec 02 §1.5 — PageHeader slot detection logic.
//
// Detection is by `displayName` (NOT reference equality), so the
// matcher survives HMR, memoised wrappers, and duplicate module
// instances across bundles. We pin that invariant here.
//
// Visual / DOM behaviour (Title-row layout, Actions right-alignment,
// stack order under 640px) is covered at the Playwright layer in PR 2.

function el(
  Component: unknown,
  children: React.ReactNode,
  key?: string,
): React.ReactElement {
  // Helper so the test reads more like JSX without bringing JSX into a
  // .test.ts file (vitest config is `*.test.ts` only). The `unknown`
  // cast is intentional — vitest tests aren't running real React, just
  // exercising the slot detector's input shape.
  return React.createElement(
    Component as React.JSXElementConstructor<Record<string, unknown>>,
    { key, children } as Record<string, unknown>,
  );
}

describe("PageHeader slot detection", () => {
  it("subcomponent displayNames match the expected slot names", () => {
    expect(PageHeader.Breadcrumb.displayName).toBe(
      PAGE_HEADER_SLOT_NAMES.Breadcrumb,
    );
    expect(PageHeader.Title.displayName).toBe(PAGE_HEADER_SLOT_NAMES.Title);
    expect(PageHeader.Subtitle.displayName).toBe(
      PAGE_HEADER_SLOT_NAMES.Subtitle,
    );
    expect(PageHeader.Meta.displayName).toBe(PAGE_HEADER_SLOT_NAMES.Meta);
    expect(PageHeader.Actions.displayName).toBe(
      PAGE_HEADER_SLOT_NAMES.Actions,
    );
  });

  it("picks Title and Actions out of mixed children regardless of JSX order", () => {
    const children = [
      el(PageHeader.Actions, "Actions", "a"),
      el(PageHeader.Title, "Hello", "t"),
    ];
    const { slots } = pickSlots(children);
    expect(slots.Title).toBeDefined();
    expect(slots.Actions).toBeDefined();
  });

  it("multiple Title children: first wins, duplicates flagged", () => {
    const children = [
      el(PageHeader.Title, "First", "t1"),
      el(PageHeader.Title, "Second", "t2"),
    ];
    const { slots, duplicates } = pickSlots(children);
    expect(slots.Title).toBeDefined();
    const titleProps = slots.Title?.props as { children?: React.ReactNode };
    expect(titleProps?.children).toBe("First");
    expect(duplicates).toContain("Title");
  });

  it("multiple Actions children: first wins, duplicates flagged", () => {
    const children = [
      el(PageHeader.Actions, "First", "a1"),
      el(PageHeader.Actions, "Second", "a2"),
    ];
    const { slots, duplicates } = pickSlots(children);
    expect(slots.Actions).toBeDefined();
    expect(duplicates).toContain("Actions");
  });

  it("React Fragment children unwrap one level so <><Title /></> works", () => {
    const inner = el(PageHeader.Title, "Hello", "t");
    const fragment = React.createElement(
      React.Fragment,
      { key: "f" },
      inner,
    );
    const { slots } = pickSlots([fragment]);
    expect(slots.Title).toBeDefined();
  });

  it("ignores children that don't match any slot", () => {
    const children = [
      React.createElement("div", { key: "d" }, "noise"),
      el(PageHeader.Title, "Hello", "t"),
    ];
    const { slots } = pickSlots(children);
    expect(slots.Title).toBeDefined();
    expect(Object.keys(slots).length).toBe(1);
  });

  it("works when wrapped in React.memo (displayName flows through)", () => {
    // memo() returns a different object than the original component but
    // preserves displayName when explicitly set. Mirrors what HMR /
    // memo wrapping looks like in real callers.
    const MemoTitle = Object.assign(React.memo(PageHeader.Title), {
      displayName: PAGE_HEADER_SLOT_NAMES.Title,
    });
    const child = el(MemoTitle, "Memoised", "m");
    const { slots } = pickSlots([child]);
    expect(slots.Title).toBeDefined();
  });
});
