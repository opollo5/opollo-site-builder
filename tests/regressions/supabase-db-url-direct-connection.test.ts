import { describe, expect, it } from "vitest";

import { parseDbUrl } from "@/lib/db-direct";

// ---------------------------------------------------------------------------
// REGRESSION: SUPABASE_DB_URL must be the session pooler URL, not the
// direct connection host.
//
// Incident (2026-05-27): SUPABASE_DB_URL was set to the Supabase direct
// connection URL (db.<ref>.supabase.co). Supabase deprecated IPv4 on direct
// connections — Vercel functions are IPv4-only — causing ALL direct-pg crons
// (publish-due, process-brief-runner, etc.) to fail with:
//   getaddrinfo ENOTFOUND db.sazapxgmrdaewrkwoxby.supabase.co
//
// Fix: parseDbUrl now throws immediately with a clear message when it detects
// the direct-connection hostname pattern, rather than failing later with a
// cryptic DNS error.
//
// Pooler URL format:
//   postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
// ---------------------------------------------------------------------------

describe("parseDbUrl — direct-connection rejection (regression)", () => {
  it("throws a descriptive error for Supabase direct connection host (db.*.supabase.co)", () => {
    const directUrl =
      "postgresql://postgres:password123@db.sazapxgmrdaewrkwoxby.supabase.co:5432/postgres";
    expect(() => parseDbUrl(directUrl)).toThrowError(
      /direct connection host.*IPv6.*Vercel.*IPv4/i,
    );
  });

  it("includes the pooler URL hint in the error message", () => {
    const directUrl =
      "postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres";
    expect(() => parseDbUrl(directUrl)).toThrowError("pooler.supabase.com");
  });

  it("accepts a valid session pooler URL", () => {
    const poolerUrl =
      "postgresql://postgres.sazapxgmrdaewrkwoxby:password@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";
    const config = parseDbUrl(poolerUrl);
    expect(config.host).toBe("aws-0-ap-southeast-2.pooler.supabase.com");
    expect(config.port).toBe(5432);
  });

  it("accepts a localhost URL (local dev / CI)", () => {
    const localUrl = "postgresql://postgres:postgres@localhost:54322/postgres";
    const config = parseDbUrl(localUrl);
    expect(config.host).toBe("localhost");
    expect(config.ssl).toBe(false);
  });

  it("rejects an unparseable URL", () => {
    expect(() => parseDbUrl("not-a-url")).toThrowError(/not a parseable URL/i);
  });
});
