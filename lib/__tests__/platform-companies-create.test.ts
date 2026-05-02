import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPlatformCompany } from "@/lib/platform/companies";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// P3-2 — createPlatformCompany lib helper.
//
// Validation, slug auto-generation, and slug-collision (23505 → ALREADY_EXISTS).
// Service-role bypasses RLS so the helper is exercised in isolation.
// ---------------------------------------------------------------------------

describe("lib/platform/companies/create — createPlatformCompany", () => {
  const tracked: string[] = [];

  beforeAll(() => {
    // Each test inserts a row; collect ids for afterAll cleanup since
    // _setup.ts TRUNCATEs platform_companies between tests anyway, but
    // some tests don't trigger beforeEach (no SeededAuthUser).
  });

  afterAll(async () => {
    if (tracked.length === 0) return;
    const svc = getServiceRoleClient();
    await svc.from("platform_companies").delete().in("id", tracked);
  });

  it("happy path — creates company, returns full row", async () => {
    const result = await createPlatformCompany({
      name: "Acme Co",
      slug: "p3-2-acme-happy",
      domain: "p3-2-acme-happy.test",
      createdBy: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    tracked.push(result.data.id);

    expect(result.data.name).toBe("Acme Co");
    expect(result.data.slug).toBe("p3-2-acme-happy");
    expect(result.data.domain).toBe("p3-2-acme-happy.test");
    expect(result.data.is_opollo_internal).toBe(false);
    expect(result.data.timezone).toBe("Australia/Melbourne");
  });

  it("auto-generates slug from name when slug omitted", async () => {
    const result = await createPlatformCompany({
      name: "Auto Slug Co",
      createdBy: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    tracked.push(result.data.id);

    expect(result.data.slug).toBe("auto-slug-co");
  });

  it("trims whitespace from name", async () => {
    const result = await createPlatformCompany({
      name: "  Trim Co  ",
      createdBy: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    tracked.push(result.data.id);
    expect(result.data.name).toBe("Trim Co");
    expect(result.data.slug).toBe("trim-co");
  });

  it("normalises domain — null when blank string supplied", async () => {
    const result = await createPlatformCompany({
      name: "No Domain Co",
      slug: "p3-2-no-domain",
      domain: "",
      createdBy: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    tracked.push(result.data.id);
    expect(result.data.domain).toBeNull();
  });

  it("rejects empty name with VALIDATION_FAILED", async () => {
    const result = await createPlatformCompany({
      name: "   ",
      createdBy: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects slug with disallowed characters", async () => {
    const result = await createPlatformCompany({
      name: "X",
      slug: "Bad Slug!",
      createdBy: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects oversize slug", async () => {
    const result = await createPlatformCompany({
      name: "X",
      slug: "a".repeat(61),
      createdBy: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns ALREADY_EXISTS on duplicate slug", async () => {
    const slug = `p3-2-dupe-${Date.now()}`;
    const first = await createPlatformCompany({
      name: "Dupe One",
      slug,
      createdBy: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    tracked.push(first.data.id);

    const second = await createPlatformCompany({
      name: "Dupe Two",
      slug,
      createdBy: null,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("ALREADY_EXISTS");
  });

  it("auto-generated slug strips diacritics + non-alphanumerics", async () => {
    const result = await createPlatformCompany({
      name: "Café & Crème: Wow!",
      createdBy: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    tracked.push(result.data.id);
    // Combining diacritics stripped, & and : and ! become hyphens that
    // collapse to single dashes, leading/trailing dashes trimmed.
    expect(result.data.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(result.data.slug).toContain("cafe");
  });
});
