import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// service-auth.ts unit tests.
//
// Tests the authenticate/validate logic without hitting Supabase. The
// Supabase client and auth session are mocked at module boundaries.
// ---------------------------------------------------------------------------

// Mock @/lib/supabase before importing service-auth so the module never
// tries to instantiate a real Supabase client.
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: vi.fn(),
}));

// server-only is a no-op in vitest
vi.mock("server-only", () => ({}));

import { getServiceRoleClient } from "@/lib/supabase";
import { createRouteAuthClient } from "@/lib/auth";
import {
  authenticateRequest,
  validateServiceActorCompany,
} from "@/lib/platform/auth/service-auth";

const mockSvcClient = {
  from: vi.fn(),
};
const mockRouteClient = {
  auth: {
    getUser: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServiceRoleClient).mockReturnValue(mockSvcClient as never);
  vi.mocked(createRouteAuthClient).mockReturnValue(mockRouteClient as never);
});

// ---------------------------------------------------------------------------
// authenticateRequest
// ---------------------------------------------------------------------------

describe("authenticateRequest — service key path", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, PLATFORM_SERVICE_API_KEY: "test-secret-key-abc" };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns kind=service when api key + actor id are correct", async () => {
    const req = new Request("https://test.example", {
      headers: {
        "x-platform-service-key": "test-secret-key-abc",
        "x-platform-actor-id": "cap-stable-actor-001",
      },
    });

    const result = await authenticateRequest(req);

    expect(result.kind).toBe("service");
    if (result.kind === "service") {
      expect(result.actorId).toBe("cap-stable-actor-001");
    }
  });

  it("returns kind=deny when api key is wrong", async () => {
    const req = new Request("https://test.example", {
      headers: {
        "x-platform-service-key": "wrong-key",
        "x-platform-actor-id": "cap-actor",
      },
    });

    const result = await authenticateRequest(req);
    expect(result.kind).toBe("deny");
  });

  it("returns kind=deny when actor id header is missing", async () => {
    const req = new Request("https://test.example", {
      headers: { "x-platform-service-key": "test-secret-key-abc" },
    });

    const result = await authenticateRequest(req);
    expect(result.kind).toBe("deny");
  });

  it("returns kind=deny when PLATFORM_SERVICE_API_KEY env var is not set", async () => {
    delete process.env.PLATFORM_SERVICE_API_KEY;

    const req = new Request("https://test.example", {
      headers: {
        "x-platform-service-key": "any-key",
        "x-platform-actor-id": "cap-actor",
      },
    });

    const result = await authenticateRequest(req);
    expect(result.kind).toBe("deny");
  });
});

describe("authenticateRequest — session path", () => {
  it("returns kind=user when session is valid", async () => {
    mockRouteClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-uuid-123" } },
      error: null,
    });

    const req = new Request("https://test.example");
    const result = await authenticateRequest(req);

    expect(result.kind).toBe("user");
    if (result.kind === "user") {
      expect(result.userId).toBe("user-uuid-123");
    }
  });

  it("returns kind=deny when session is missing", async () => {
    mockRouteClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const req = new Request("https://test.example");
    const result = await authenticateRequest(req);
    expect(result.kind).toBe("deny");
  });

  it("returns kind=deny when getUser returns an error", async () => {
    mockRouteClient.auth.getUser.mockResolvedValue({
      data: {},
      error: new Error("auth error"),
    });

    const req = new Request("https://test.example");
    const result = await authenticateRequest(req);
    expect(result.kind).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// validateServiceActorCompany
// ---------------------------------------------------------------------------

describe("validateServiceActorCompany", () => {
  function mockFrom(returnData: unknown) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: null }),
    };
    mockSvcClient.from.mockReturnValue(chain);
    return chain;
  }

  it("returns ok=true when cap_weekly_enabled is true", async () => {
    mockFrom({ cap_weekly_enabled: true });
    const result = await validateServiceActorCompany("company-uuid-1");
    expect(result.ok).toBe(true);
  });

  it("returns ok=false when cap_weekly_enabled is false", async () => {
    mockFrom({ cap_weekly_enabled: false });
    const result = await validateServiceActorCompany("company-uuid-1");
    expect(result.ok).toBe(false);
  });

  it("returns ok=false when company not found", async () => {
    mockFrom(null);
    const result = await validateServiceActorCompany("nonexistent-uuid");
    expect(result.ok).toBe(false);
  });
});
