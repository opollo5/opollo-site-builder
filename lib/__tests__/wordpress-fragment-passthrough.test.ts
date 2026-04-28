import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  wpCreatePage,
  wpCreatePost,
  wpUpdatePage,
  wpUpdatePost,
  type WpConfig,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// PB-7 (2026-04-29) — fragment passthrough regression.
//
// PB-1 (PR #194) flipped the runner from emitting full HTML documents
// to emitting body fragments (`<section data-opollo …>…</section>`).
// The publish path (wpCreatePage / wpCreatePost / wpUpdatePage /
// wpUpdatePost) was not changed: each wrapper POSTs whatever string
// the caller hands in as `content` straight to WP REST. WP's
// `wp_kses_post` sanitiser may strip unknown attributes — including
// `data-opollo` — so this test pins the boundary: the WRAPPER itself
// passes the bytes through unchanged. Anything WP does to the bytes
// AFTER they arrive is an operator-side wp_kses_allowed_html question
// (see docs/RUNBOOK.md).
//
// Pure unit tests — no real WP, no Supabase. fetch is stubbed.
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FAKE_CFG: WpConfig = {
  baseUrl: "https://example.wp.test",
  user: "admin",
  appPassword: "xxxx yyyy zzzz",
};

const FAKE_WP_PAGE = {
  id: 42,
  title: { rendered: "x", raw: "x" },
  slug: "x",
  status: "draft",
  link: "https://example.wp.test/?p=42",
  content: { rendered: "<p>x</p>", raw: "<p>x</p>" },
};

const FAKE_WP_POST = {
  id: 99,
  title: { rendered: "x", raw: "x" },
  slug: "x",
  status: "draft",
  link: "https://example.wp.test/?p=99",
  content: { rendered: "<p>x</p>", raw: "<p>x</p>" },
};

const PATH_B_FRAGMENT = `<section data-opollo class="ls-hero" data-ds-version="3">
  <h1>Welcome to Acme</h1>
  <p>The friendly cybersecurity team in Melbourne.</p>
  <a class="ls-cta" href="/contact">Get in touch</a>
</section>
<section data-opollo class="ls-features">
  <h2>Why choose us</h2>
  <ul>
    <li class="ls-feature">Fast response.</li>
    <li class="ls-feature">Plain-language reporting.</li>
  </ul>
</section>`;

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
  const p = fn();
  await vi.runAllTimersAsync();
  return p;
}

describe("PB-7 — wpCreatePage forwards path-B fragment content unchanged", () => {
  it("preserves the fragment exactly in the request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));
    await callAndFlush(() =>
      wpCreatePage(FAKE_CFG, {
        title: "Welcome",
        slug: "welcome",
        content: PATH_B_FRAGMENT,
        meta_description: "Acme welcomes you to friendly cybersecurity.",
        template_type: "generic",
        ds_version: "3",
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.content).toBe(PATH_B_FRAGMENT);
    // Verify specific path-B markers survive the JSON-encode round-trip.
    const content = body.content as string;
    expect(content).toContain("<section data-opollo");
    expect(content).toContain('data-ds-version="3"');
    expect(content).toContain('class="ls-hero"');
    expect(content).not.toContain("<!DOCTYPE");
    expect(content).not.toContain("<html");
    expect(content).not.toContain("<body");
  });
});

describe("PB-7 — wpUpdatePage forwards path-B fragment content unchanged", () => {
  it("preserves the fragment exactly in the request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, FAKE_WP_PAGE));
    await callAndFlush(() =>
      wpUpdatePage(FAKE_CFG, 42, {
        title: "Welcome",
        slug: "welcome",
        content: PATH_B_FRAGMENT,
        meta_description: "Acme welcomes you to friendly cybersecurity.",
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.content).toBe(PATH_B_FRAGMENT);
  });
});

describe("PB-7 — wpCreatePost forwards path-B fragment content unchanged", () => {
  it("preserves the fragment exactly in the request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() =>
      wpCreatePost(FAKE_CFG, {
        title: "Why choose Acme",
        slug: "why-acme",
        content: PATH_B_FRAGMENT,
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.content).toBe(PATH_B_FRAGMENT);
    const content = body.content as string;
    expect(content).toContain("<section data-opollo");
    expect(content).not.toContain("<head");
    expect(content).not.toContain("<nav");
  });
});

describe("PB-7 — wpUpdatePost forwards path-B fragment content unchanged", () => {
  it("preserves the fragment exactly in the request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, FAKE_WP_POST));
    await callAndFlush(() =>
      wpUpdatePost(FAKE_CFG, 99, {
        title: "Why choose Acme",
        slug: "why-acme",
        content: PATH_B_FRAGMENT,
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.content).toBe(PATH_B_FRAGMENT);
  });
});
