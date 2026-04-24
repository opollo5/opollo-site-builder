import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3a — integration tests for app/api/chat/route.ts.
//
// The chat route (M1b + M5 headline feature) had no unit/integration test —
// only an E2E spec that intercepts the HTTP call browser-side, so the server
// handler never ran in CI. Per docs/TEST_COVERAGE_AUDIT_2026-04-24.md
// finding #2, this test file closes that gap.
//
// All external dependencies are mocked; this test DOES NOT require a running
// Supabase instance, Anthropic API key, or Upstash Redis.
//
// Tests cover:
//   P0 — Validation: missing body, empty messages array
//   P0 — Config: missing ANTHROPIC_API_KEY → 500
//   P0 — Streaming happy path: text deltas + done in SSE
//   P0 — Error sanitization: SSE error event does NOT leak err.message
//   P1 — Tool dispatch: tool_use → tool_result → text → done
//   P1 — Unknown tool: tool_result with is_error: true
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hoisted mock state — must come before all vi.mock calls.
// ---------------------------------------------------------------------------

const mockStream = vi.hoisted(() => vi.fn());

const mockState = vi.hoisted(() => ({
  getSiteResult: {
    ok: true as boolean,
    data: {
      site: {
        id: "site-uuid-1",
        name: "Test Site",
        wp_url: "https://test.example.com",
        prefix: "ts",
        design_system_version: "1.0.0",
      },
      credentials: {
        wp_user: "admin",
        wp_app_password: "app-pass-123",
      },
    },
    error: undefined as { code: string; message: string } | undefined,
  },
  rateLimitOk: true,
  currentUser: null as { id: string; email: string; role: string } | null,
}));

// ---------------------------------------------------------------------------
// vi.mock declarations — all must be top-level, before any imports.
// ---------------------------------------------------------------------------

// Anthropic SDK — replace the default Anthropic class with a stub whose
// messages.stream is the hoisted mockStream. Re-export the real APIError
// so the route's `err instanceof Anthropic.APIError` checks still work.
vi.mock("@anthropic-ai/sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@anthropic-ai/sdk")>(
      "@anthropic-ai/sdk",
    );
  return {
    ...actual,
    default: class MockAnthropic {
      messages = { stream: mockStream };
      // Static property mirror so the real APIError is accessible via
      // the imported default:  import Anthropic from "@anthropic-ai/sdk"
      //                        Anthropic.APIError
      static APIError = actual.default.APIError;
      constructor(_: { apiKey: string }) {}
    },
  };
});

// lib/auth — mock createRouteAuthClient + getCurrentUser.
// The route calls createRouteAuthClient() then passes the result to
// getCurrentUser(supabase). We need next/headers cookies() to not throw,
// so we also stub createRouteAuthClient to return a dummy client.
vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({}),
  getCurrentUser: async () => mockState.currentUser,
}));

// next/headers — cookies() is called by createRouteAuthClient's real
// implementation when not mocked, but since we mock @/lib/auth above the
// direct call is intercepted. Mock anyway to prevent import-time errors from
// next/headers being unavailable in the vitest environment.
vi.mock("next/headers", () => ({
  cookies: () => ({
    getAll: () => [],
    set: () => {},
  }),
  headers: () => new Headers(),
}));

// lib/rate-limit — fail-open by default; individual tests override.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () =>
    mockState.rateLimitOk
      ? { ok: true, limit: 120, remaining: 119, reset: 0 }
      : {
          ok: false,
          limit: 120,
          remaining: 0,
          reset: Date.now() + 60_000,
          retryAfterSec: 60,
        },
  rateLimitExceeded: (
    result: Extract<{ ok: false; retryAfterSec: number }, object>,
  ) =>
    new Response(
      JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }),
      { status: 429, headers: { "content-type": "application/json" } },
    ),
  getClientIp: () => "127.0.0.1",
}));

// lib/sites — return a deterministic site without hitting the DB.
vi.mock("@/lib/sites", () => ({
  getSite: async (_id: string, _opts: unknown) => {
    if (!mockState.getSiteResult.ok) {
      return {
        ok: false,
        error: mockState.getSiteResult.error ?? {
          code: "NOT_FOUND",
          message: "Site not found",
        },
        timestamp: new Date().toISOString(),
      };
    }
    return {
      ok: true,
      data: mockState.getSiteResult.data,
      timestamp: new Date().toISOString(),
    };
  },
}));

// lib/system-prompt — skip the DS-heavy prompt assembly.
vi.mock("@/lib/system-prompt", () => ({
  buildSystemPromptForSite: async () => "MOCK_SYSTEM_PROMPT",
}));

// lib/langfuse — no-op span handles so traceAnthropicStream is transparent.
vi.mock("@/lib/langfuse", () => ({
  traceAnthropicStream: () => ({
    recordFinal: () => {},
    fail: () => {},
    traceId: null,
  }),
}));

// lib/logger — capture calls without console noise.
const loggerCalls = vi.hoisted(() => ({
  info: [] as Array<[string, Record<string, unknown> | undefined]>,
  warn: [] as Array<[string, Record<string, unknown> | undefined]>,
  error: [] as Array<[string, Record<string, unknown> | undefined]>,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.info.push([msg, fields]),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.warn.push([msg, fields]),
    error: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.error.push([msg, fields]),
  },
}));

// lib/search-images — for tool dispatch tests.
const mockSearchImages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/search-images", () => ({
  executeSearchImages: mockSearchImages,
}));

// ---------------------------------------------------------------------------
// Import route AFTER all vi.mock declarations.
// ---------------------------------------------------------------------------
import { POST } from "@/app/api/chat/route";
import Anthropic from "@anthropic-ai/sdk";
import {
  SAFE_CHAT_ERROR_MESSAGE,
  SAFE_CHAT_ERROR_CODE,
} from "@/lib/chat-errors";

// ---------------------------------------------------------------------------
// ENV isolation
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save + set required env vars.
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = "test-anthropic-api-key";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-test";

  // Reset mock state.
  mockStream.mockReset();
  mockSearchImages.mockReset();
  mockState.rateLimitOk = true;
  mockState.currentUser = null;
  mockState.getSiteResult = {
    ok: true,
    data: {
      site: {
        id: "site-uuid-1",
        name: "Test Site",
        wp_url: "https://test.example.com",
        prefix: "ts",
        design_system_version: "1.0.0",
      },
      credentials: {
        wp_user: "admin",
        wp_app_password: "app-pass-123",
      },
    },
    error: undefined,
  };

  loggerCalls.info.length = 0;
  loggerCalls.warn.length = 0;
  loggerCalls.error.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------
// Stream stub factory.
// ---------------------------------------------------------------------------

type TextEvent = { type: "text"; text: string };
type ToolUseEvent = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type StreamEvent = TextEvent | ToolUseEvent;

function streamStub(opts: {
  events: StreamEvent[];
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
  throws?: Error;
}) {
  const anthropicEvents: unknown[] = opts.events
    .map((e) =>
      e.type === "text"
        ? {
            type: "content_block_delta",
            delta: { type: "text_delta", text: e.text },
          }
        : null,
    )
    .filter(Boolean);

  return {
    async *[Symbol.asyncIterator]() {
      if (opts.throws) throw opts.throws;
      for (const ev of anthropicEvents) yield ev as never;
    },
    finalMessage: async () => {
      if (opts.throws) throw opts.throws;
      const content: unknown[] = [];
      for (const e of opts.events) {
        if (e.type === "text")
          content.push({ type: "text", text: e.text });
        if (e.type === "tool_use")
          content.push({
            type: "tool_use",
            id: e.id,
            name: e.name,
            input: e.input,
          });
      }
      return {
        id: "msg_test_abc",
        model: "claude-opus-4-7",
        stop_reason: opts.stopReason ?? "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        content,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// SSE parsing helper.
// ---------------------------------------------------------------------------

async function readSse(
  res: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const event =
      lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
    const dataLine =
      lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "";
    events.push({ event, data: dataLine ? JSON.parse(dataLine) : null });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Request factory helpers.
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, opts?: { noContentType?: boolean }): Request {
  const headers: Record<string, string> = {};
  if (!opts?.noContentType)
    headers["content-type"] = "application/json";
  return new Request("https://opollo.vercel.app/api/chat", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_MESSAGES = [{ role: "user", content: "Hello" }];

// ---------------------------------------------------------------------------
// P0 — Validation
// ---------------------------------------------------------------------------

describe("POST /api/chat — validation", () => {
  it("returns 400 VALIDATION_FAILED when body is not JSON", async () => {
    const req = new Request("https://opollo.vercel.app/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json-at-all",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED when messages array is empty", async () => {
    const res = await POST(makeRequest({ messages: [] }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED when messages field is missing", async () => {
    const res = await POST(makeRequest({ activeSiteId: "abc" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED when messages is not an array", async () => {
    const res = await POST(
      makeRequest({ messages: "not-an-array" }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// P0 — Config: missing ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

describe("POST /api/chat — ANTHROPIC_API_KEY config", () => {
  it("returns 500 INTERNAL_ERROR when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    // Mock getSite so we reach the API key check.
    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    // The static message must reference the config key.
    expect(body.error.message).toContain("ANTHROPIC_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// P0 — Streaming happy path
// ---------------------------------------------------------------------------

describe("POST /api/chat — streaming happy path", () => {
  it("returns 200 with text/event-stream and correct SSE events", async () => {
    mockStream.mockReturnValue(
      streamStub({
        events: [
          { type: "text", text: "hello" },
          { type: "text", text: " world" },
        ],
        stopReason: "end_turn",
      }),
    );

    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const events = await readSse(res);

    const textEvents = events.filter((e) => e.event === "text");
    expect(textEvents).toHaveLength(2);
    expect((textEvents[0].data as { delta: string }).delta).toBe("hello");
    expect((textEvents[1].data as { delta: string }).delta).toBe(" world");

    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0].data as { stop_reason: string }).stop_reason).toBe(
      "end_turn",
    );

    // No error event on happy path.
    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents).toHaveLength(0);
  });

  it("uses LeadSource fallback when no activeSiteId is provided", async () => {
    mockStream.mockReturnValue(
      streamStub({
        events: [{ type: "text", text: "response text" }],
        stopReason: "end_turn",
      }),
    );

    // No activeSiteId — should NOT call getSite.
    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("resolves site context when activeSiteId is provided", async () => {
    mockStream.mockReturnValue(
      streamStub({
        events: [{ type: "text", text: "site response" }],
        stopReason: "end_turn",
      }),
    );

    const res = await POST(
      makeRequest({
        messages: VALID_MESSAGES,
        activeSiteId: "site-uuid-1",
      }) as never,
    );
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((e) => e.event === "done")).toBe(true);
    expect(events.some((e) => e.event === "error")).toBe(false);
  });

  it("returns 404 JSON (not SSE) when getSite returns NOT_FOUND", async () => {
    mockState.getSiteResult = {
      ok: false,
      data: undefined as never,
      error: { code: "NOT_FOUND", message: "Site not found" },
    };

    const res = await POST(
      makeRequest({
        messages: VALID_MESSAGES,
        activeSiteId: "nonexistent-site",
      }) as never,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// P0 — Error sanitization (M15-4 invariant)
// ---------------------------------------------------------------------------

describe("POST /api/chat — error sanitization", () => {
  it("emits SSE error event with static code + message when stream throws plain Error", async () => {
    const leakyMessage =
      "Internal Supabase error: column X does not exist in relation opollo_users";
    mockStream.mockReturnValue(
      streamStub({
        events: [],
        throws: new Error(leakyMessage),
      }),
    );

    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(200); // SSE — always 200 even on error
    const events = await readSse(res);

    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents).toHaveLength(1);

    const payload = errorEvents[0].data as {
      code: string;
      message: string;
      request_id: string | null;
    };

    // Positive assertions: correct static shape.
    expect(payload.code).toBe(SAFE_CHAT_ERROR_CODE);
    expect(payload.message).toBe(SAFE_CHAT_ERROR_MESSAGE);
    expect("request_id" in payload).toBe(true);

    // Negative assertions: no leaky content.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("column X");
    expect(serialized).not.toContain("opollo_users");
    expect(serialized).not.toContain("Supabase");
    expect(serialized).not.toContain("does not exist");

    // No done event after error.
    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents).toHaveLength(0);
  });

  it("emits SSE error event without leaking Anthropic.APIError body", async () => {
    const leakyApiErrBody = {
      error: { type: "rate_limit_exceeded", message: "org_secret123 exceeded quota" },
    };
    const apiErr = new Anthropic.APIError(
      429,
      leakyApiErrBody,
      "429 rate_limit_exceeded: org_secret123 exceeded quota",
      new Headers({ "x-anthropic-request-id": "anth-req-test" }),
    );
    mockStream.mockReturnValue(
      streamStub({
        events: [],
        throws: apiErr,
      }),
    );

    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    const events = await readSse(res);

    const errorEvents = events.filter((e) => e.event === "error");
    expect(errorEvents).toHaveLength(1);

    const payload = errorEvents[0].data as { code: string; message: string };

    // Must be the static safe payload.
    expect(payload.code).toBe(SAFE_CHAT_ERROR_CODE);
    expect(payload.message).toBe(SAFE_CHAT_ERROR_MESSAGE);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("org_secret123");
    expect(serialized).not.toContain("rate_limit_exceeded");
    expect(serialized).not.toContain("anth-req-test");
    expect(serialized).not.toContain("429");
  });

  it("logs the full diagnostic to the server logger (not the SSE payload)", async () => {
    const leakyMsg = "internal-db-detail-xyz";
    mockStream.mockReturnValue(
      streamStub({
        events: [],
        throws: new Error(leakyMsg),
      }),
    );

    await POST(makeRequest({ messages: VALID_MESSAGES }) as never);

    // The error should appear in the server logger.
    const errorLog = loggerCalls.error.find(
      ([msg]) => msg === "api.chat.streaming_error",
    );
    expect(errorLog).toBeDefined();

    // The diagnostic logged must contain the actual error message.
    const [, fields] = errorLog as [string, Record<string, unknown>];
    expect(typeof fields?.message).toBe("string");
    expect((fields.message as string)).toContain(leakyMsg);
  });
});

// ---------------------------------------------------------------------------
// P1 — Tool dispatch (search_images — simplest, no WP creds path)
// ---------------------------------------------------------------------------

describe("POST /api/chat — tool dispatch", () => {
  it("dispatches search_images tool, emits tool_use + tool_result + text + done", async () => {
    const toolId = "toolu_test_001";
    const searchInput = { query: "sunset beach" };
    const searchResult = {
      ok: true,
      data: {
        images: [
          {
            id: "img-1",
            cdn_url: "https://cdn.example.com/1.jpg",
            caption: "Sunset beach",
            tags: ["sunset"],
            width: 1920,
            height: 1080,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        total: 1,
      },
      timestamp: new Date().toISOString(),
    };
    mockSearchImages.mockResolvedValue(searchResult);

    // First iteration: tool_use with stop_reason "tool_use"
    const firstStub = streamStub({
      events: [{ type: "tool_use", id: toolId, name: "search_images", input: searchInput }],
      stopReason: "tool_use",
    });

    // Second iteration: plain text with end_turn
    const secondStub = streamStub({
      events: [{ type: "text", text: "Here are your images." }],
      stopReason: "end_turn",
    });

    mockStream
      .mockReturnValueOnce(firstStub)
      .mockReturnValueOnce(secondStub);

    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(200);

    const events = await readSse(res);
    const eventTypes = events.map((e) => e.event);

    // Must include: tool_use, tool_result, text, done (in order)
    expect(eventTypes).toContain("tool_use");
    expect(eventTypes).toContain("tool_result");
    expect(eventTypes).toContain("text");
    expect(eventTypes).toContain("done");

    const tuIdx = eventTypes.indexOf("tool_use");
    const trIdx = eventTypes.indexOf("tool_result");
    const textIdx = eventTypes.indexOf("text");
    const doneIdx = eventTypes.indexOf("done");

    // Ordering: tool_use before tool_result, tool_result before text, text before done
    expect(tuIdx).toBeLessThan(trIdx);
    expect(trIdx).toBeLessThan(textIdx);
    expect(textIdx).toBeLessThan(doneIdx);

    // tool_use payload shape.
    const tuPayload = events[tuIdx].data as {
      id: string;
      name: string;
      input: unknown;
    };
    expect(tuPayload.id).toBe(toolId);
    expect(tuPayload.name).toBe("search_images");

    // tool_result payload shape.
    const trPayload = events[trIdx].data as {
      tool_use_id: string;
      is_error: boolean;
    };
    expect(trPayload.tool_use_id).toBe(toolId);
    expect(trPayload.is_error).toBe(false);

    // done payload.
    const donePayload = events[doneIdx].data as { stop_reason: string };
    expect(donePayload.stop_reason).toBe("end_turn");

    // Tool executor was invoked once.
    expect(mockSearchImages).toHaveBeenCalledTimes(1);
    expect(mockSearchImages).toHaveBeenCalledWith(searchInput);
  });

  it("returns tool_result with is_error: true for unknown tool name", async () => {
    const toolId = "toolu_unknown_001";
    const unknownToolStub = streamStub({
      events: [
        {
          type: "tool_use",
          id: toolId,
          name: "nonexistent_tool",
          input: {},
        },
      ],
      stopReason: "tool_use",
    });

    // Second iteration needed so the route can complete (stop_reason="end_turn").
    const endStub = streamStub({
      events: [{ type: "text", text: "I see." }],
      stopReason: "end_turn",
    });

    mockStream.mockReturnValueOnce(unknownToolStub).mockReturnValueOnce(endStub);

    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(200);

    const events = await readSse(res);
    const trEvent = events.find((e) => e.event === "tool_result");
    expect(trEvent).toBeDefined();

    const trPayload = trEvent!.data as {
      tool_use_id: string;
      is_error: boolean;
      result: { ok: boolean; error: { code: string } };
    };
    expect(trPayload.tool_use_id).toBe(toolId);
    expect(trPayload.is_error).toBe(true);
    expect(trPayload.result.ok).toBe(false);
    expect(trPayload.result.error.code).toBe("VALIDATION_FAILED");
  });

  it("does not invoke tool executors for unknown tool names", async () => {
    const unknownToolStub = streamStub({
      events: [
        {
          type: "tool_use",
          id: "toolu_noop",
          name: "nonexistent_tool",
          input: {},
        },
      ],
      stopReason: "tool_use",
    });
    const endStub = streamStub({
      events: [],
      stopReason: "end_turn",
    });
    mockStream.mockReturnValueOnce(unknownToolStub).mockReturnValueOnce(endStub);

    await POST(makeRequest({ messages: VALID_MESSAGES }) as never);

    // search_images executor was never called.
    expect(mockSearchImages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rate limiting (fail-open + denied path)
// ---------------------------------------------------------------------------

describe("POST /api/chat — rate limiting", () => {
  it("passes when rate limiter is unset (fail-open; default mock state)", async () => {
    mockStream.mockReturnValue(
      streamStub({ events: [{ type: "text", text: "ok" }], stopReason: "end_turn" }),
    );
    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(200);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockState.rateLimitOk = false;
    const res = await POST(makeRequest({ messages: VALID_MESSAGES }) as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
