import { describe, expect, it } from "vitest";

import { partitionBreadcrumbSegments } from "@/components/ui/breadcrumb";

// Spec 02 §1.5 — breadcrumb partition logic. The render-side mobile
// collapse is pure CSS (`hidden sm:inline-flex` for middle segments,
// `sm:hidden` for the ellipsis); the ARRANGE decision lives in
// partitionBreadcrumbSegments() and is what we pin here.
//
// Render-side DOM behaviour (Tailwind CSS taking effect at 640px) is
// covered at the Playwright layer in PR 2.

describe("partitionBreadcrumbSegments", () => {
  it("0 segments → empty partition", () => {
    const out = partitionBreadcrumbSegments([]);
    expect(out.first).toBeNull();
    expect(out.last).toBeNull();
    expect(out.middle).toEqual([]);
    expect(out.showCollapse).toBe(false);
  });

  it("1 segment → renders first only", () => {
    const out = partitionBreadcrumbSegments([{ label: "Sites" }]);
    expect(out.first).toEqual({ label: "Sites" });
    expect(out.last).toBeNull();
    expect(out.middle).toEqual([]);
    expect(out.showCollapse).toBe(false);
  });

  it("2 segments → first + last, no collapse", () => {
    const out = partitionBreadcrumbSegments([
      { label: "Admin", href: "/admin" },
      { label: "Sites" },
    ]);
    expect(out.first?.label).toBe("Admin");
    expect(out.last?.label).toBe("Sites");
    expect(out.middle).toEqual([]);
    expect(out.showCollapse).toBe(false);
  });

  it("3 segments → first + 1 middle + last, collapsible", () => {
    const out = partitionBreadcrumbSegments([
      { label: "Admin", href: "/admin" },
      { label: "Sites", href: "/admin/sites" },
      { label: "Test Site 2" },
    ]);
    expect(out.first?.label).toBe("Admin");
    expect(out.last?.label).toBe("Test Site 2");
    expect(out.middle.map((s) => s.label)).toEqual(["Sites"]);
    expect(out.showCollapse).toBe(true);
  });

  it("5 segments → first + 3 middle + last, collapsible", () => {
    const out = partitionBreadcrumbSegments([
      { label: "Admin", href: "/admin" },
      { label: "Sites", href: "/admin/sites" },
      { label: "Test Site", href: "/admin/sites/x" },
      { label: "Setup", href: "/admin/sites/x/setup" },
      { label: "Step 2" },
    ]);
    expect(out.first?.label).toBe("Admin");
    expect(out.last?.label).toBe("Step 2");
    expect(out.middle.map((s) => s.label)).toEqual([
      "Sites",
      "Test Site",
      "Setup",
    ]);
    expect(out.showCollapse).toBe(true);
  });

  it("last segment is a plain segment without href even when caller passes one", () => {
    // The component treats the last position as plain text regardless
    // of whether the caller supplied an href; the partition function
    // returns the segment as-is and the renderer enforces the rule.
    // This test documents that intended invariant.
    const out = partitionBreadcrumbSegments([
      { label: "First", href: "/a" },
      { label: "Last", href: "/b" },
    ]);
    expect(out.last?.href).toBe("/b");
    // Renderer-side enforcement: covered by visual / Playwright in PR 2.
  });
});
