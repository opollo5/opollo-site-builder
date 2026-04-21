import { describe, expect, it } from "vitest";

import { GET as healthGET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with status=ok when Supabase is reachable", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: { supabase: string };
      build: { commit: string; env: string };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.supabase).toBe("ok");
    expect(typeof body.build.commit).toBe("string");
  });
});
