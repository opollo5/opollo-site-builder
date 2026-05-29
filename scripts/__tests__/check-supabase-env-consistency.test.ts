import { describe, expect, test } from "vitest";

import { checkConsistency } from "../check-supabase-env-consistency";

const PROD_REF = "sazapxgmrdaewrkwoxby";
const STAGING_REF = "bjiiqnetaxoibhcaukqm";

const POOLER_HOST_PROD = "aws-1-ap-southeast-2.pooler.supabase.com";
const POOLER_HOST_STAGING = "aws-1-ap-southeast-2.pooler.supabase.com";

function poolerUrl(ref: string, host: string): string {
  return `postgresql://postgres.${ref}:somepassword@${host}:5432/postgres`;
}

function restUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}

function directUrl(ref: string): string {
  return `postgresql://postgres:pwd@db.${ref}.supabase.co:5432/postgres`;
}

describe("checkConsistency — happy paths", () => {
  test("all three refs match + pooler host → ok", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      NEXT_PUBLIC_SUPABASE_URL: restUrl(PROD_REF),
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatch(/OK/);
  });

  test("NEXT_PUBLIC_SUPABASE_URL absent → still ok (production scope intentionally omits it)", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.vars.NEXT_PUBLIC_SUPABASE_URL.value_present).toBe(false);
  });

  test("staging refs (bjiiq) consistent → ok", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(STAGING_REF),
      NEXT_PUBLIC_SUPABASE_URL: restUrl(STAGING_REF),
      SUPABASE_DB_URL: poolerUrl(STAGING_REF, POOLER_HOST_STAGING),
    });
    expect(result.ok).toBe(true);
  });
});

describe("checkConsistency — ref mismatch", () => {
  test("SUPABASE_URL and SUPABASE_DB_URL disagree → fail (the 2026-05-29 incident shape)", () => {
    // The exact mismatch shape that caused publish-due to fail: REST URL at staging,
    // DB URL at production. The pooler returned "Tenant or user not found" because
    // it couldn't reconcile the user-portion ref (sazap) against the project tenant.
    const result = checkConsistency({
      SUPABASE_URL: restUrl(STAGING_REF),
      NEXT_PUBLIC_SUPABASE_URL: restUrl(STAGING_REF),
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Project ref mismatch"))).toBe(true);
    // Error message must surface BOTH refs so debugger can see the divergence.
    expect(result.errors.join("\n")).toContain(STAGING_REF);
    expect(result.errors.join("\n")).toContain(PROD_REF);
  });

  test("NEXT_PUBLIC disagrees with the other two → fail", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      NEXT_PUBLIC_SUPABASE_URL: restUrl(STAGING_REF),
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Project ref mismatch"))).toBe(true);
  });
});

describe("checkConsistency — direct host rejected", () => {
  test("SUPABASE_DB_URL is direct connection (db.<ref>.supabase.co) → fail", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      NEXT_PUBLIC_SUPABASE_URL: restUrl(PROD_REF),
      SUPABASE_DB_URL: directUrl(PROD_REF),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("direct-connection format"))).toBe(true);
    // Error message must mention pooler as the fix.
    expect(result.errors.join("\n")).toContain("pooler");
    expect(result.errors.join("\n")).toContain("ENOTFOUND");
  });

  test("direct host + ref-matching → still fails on the host shape alone", () => {
    // refs match (all PROD_REF) but the DB URL is still direct format.
    // This must fail — the URL would ENOTFOUND at runtime regardless of refs.
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      SUPABASE_DB_URL: directUrl(PROD_REF),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("direct-connection format"))).toBe(true);
  });
});

describe("checkConsistency — missing required vars", () => {
  test("SUPABASE_URL missing → fail", () => {
    const result = checkConsistency({
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing required env var: SUPABASE_URL"))).toBe(true);
  });

  test("SUPABASE_DB_URL missing → fail", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing required env var: SUPABASE_DB_URL"))).toBe(true);
  });

  test("both required vars missing → both errors surfaced", () => {
    const result = checkConsistency({});
    expect(result.ok).toBe(false);
    expect(result.errors.filter((e) => e.startsWith("Missing required")).length).toBe(2);
  });
});

describe("checkConsistency — unparseable value", () => {
  test("garbage SUPABASE_URL value → fail with shape error", () => {
    const result = checkConsistency({
      SUPABASE_URL: "not-a-url",
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("did not match any known Supabase URL shape"))).toBe(true);
  });
});

describe("checkConsistency — result shape", () => {
  test("vars dict reports value_present + ref + host + shape per var", () => {
    const result = checkConsistency({
      SUPABASE_URL: restUrl(PROD_REF),
      SUPABASE_DB_URL: poolerUrl(PROD_REF, POOLER_HOST_PROD),
    });
    expect(result.vars.SUPABASE_URL).toEqual(
      expect.objectContaining({ value_present: true, ref: PROD_REF, shape: "rest" }),
    );
    expect(result.vars.SUPABASE_DB_URL).toEqual(
      expect.objectContaining({ value_present: true, ref: PROD_REF, host: POOLER_HOST_PROD, shape: "pooler" }),
    );
    expect(result.vars.NEXT_PUBLIC_SUPABASE_URL).toEqual(
      expect.objectContaining({ value_present: false }),
    );
  });
});
