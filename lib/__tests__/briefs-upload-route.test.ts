import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIEF_MAX_BYTES } from "@/lib/briefs";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-1 — POST /api/briefs/upload integration tests.
//
// The auth gate is tested exhaustively in admin-api-gate.test.ts; these
// tests run with FEATURE_SUPABASE_AUTH off so the gate allows with
// user=null. Business logic (Storage write + DB insert + parser +
// idempotency) is what we pin here.
//
// We also stub the Anthropic call so the parser's inference fallback is
// deterministic (never used in these tests — fixtures use structural
// markdown — but a stub is wired as a safety net).
// ---------------------------------------------------------------------------

// revalidatePath() only works inside a Next request context. Stub it
// so the route handler doesn't throw when invoked from a Vitest test.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/anthropic-call", async () => {
  const actual = await vi.importActual<typeof import("@/lib/anthropic-call")>(
    "@/lib/anthropic-call",
  );
  return {
    ...actual,
    defaultAnthropicCall: vi.fn(async () => ({
      id: "stub-msg",
      model: "claude-sonnet-4-6",
      content: [{ type: "text" as const, text: "[]" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    })),
  };
});

import { POST as uploadBriefPOST } from "@/app/api/briefs/upload/route";

const STRUCTURAL_MD = `# Acme Brief

## Home

The home page hero lands the tagline.

## About

Company story.

## Pricing

Three tiers.
`;

function makeMultipartRequest(opts: {
  siteId?: string | null;
  title?: string;
  file?: Blob | null;
  fileName?: string;
  idempotencyKey?: string;
}): Request {
  const form = new FormData();
  if (opts.siteId !== null && opts.siteId !== undefined) {
    form.append("site_id", opts.siteId);
  }
  if (opts.title !== undefined) form.append("title", opts.title);
  if (opts.file === null) {
    // Intentionally omit file to test missing-file path.
  } else {
    const blob = opts.file ?? new Blob([STRUCTURAL_MD], { type: "text/markdown" });
    form.append("file", blob, opts.fileName ?? "brief.md");
  }
  if (opts.idempotencyKey !== undefined) {
    form.append("idempotency_key", opts.idempotencyKey);
  }
  return new Request("http://localhost/api/briefs/upload", {
    method: "POST",
    body: form,
  });
}

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let origEnv: Record<string, string | undefined>;

beforeEach(() => {
  origEnv = {};
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  // Gate off so requireAdminForApi allows the request with user: null.
  delete process.env.FEATURE_SUPABASE_AUTH;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
});

describe("POST /api/briefs/upload", () => {
  // -----------------------------------------------------------------------
  // 1. Happy path
  // -----------------------------------------------------------------------
  it("happy path: structural markdown → 201 with parsed status + brief_pages rows", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu1a" });
    const req = makeMultipartRequest({ siteId });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { ok: boolean; data?: { brief_id: string; status: string; review_url: string; replay: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe("parsed");
    expect(body.data?.replay).toBe(false);
    expect(body.data?.review_url).toMatch(new RegExp(`^/admin/sites/${siteId}/briefs/.+/review$`));

    const svc = getServiceRoleClient();
    const brief = await svc.from("briefs").select("*").eq("id", body.data!.brief_id).single();
    expect(brief.error).toBeNull();
    expect(brief.data?.status).toBe("parsed");
    expect(brief.data?.upload_idempotency_key).toBeTruthy();
    expect(brief.data?.source_storage_path).toBe(`${siteId}/${body.data!.brief_id}.md`);

    const pages = await svc
      .from("brief_pages")
      .select("id, ordinal, title")
      .eq("brief_id", body.data!.brief_id)
      .order("ordinal", { ascending: true });
    expect(pages.error).toBeNull();
    expect(pages.data?.length).toBe(3);
    expect(pages.data?.map((p) => p.title)).toEqual(["Home", "About", "Pricing"]);

    // Storage object was written.
    const list = await svc.storage.from("site-briefs").list(siteId);
    expect(list.error).toBeNull();
    expect(list.data?.some((o) => o.name === `${body.data!.brief_id}.md`)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. Dedup replay
  // -----------------------------------------------------------------------
  it("dedup: uploading the same file twice → 200 replay; no new brief row", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu2a" });

    const first = await uploadBriefPOST(makeMultipartRequest({ siteId }));
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data: { brief_id: string } };

    const second = await uploadBriefPOST(makeMultipartRequest({ siteId }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: { brief_id: string; replay: boolean } };
    expect(secondBody.data.brief_id).toBe(firstBody.data.brief_id);
    expect(secondBody.data.replay).toBe(true);

    const svc = getServiceRoleClient();
    const { count } = await svc
      .from("briefs")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId);
    expect(count).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 3. Oversized file
  // -----------------------------------------------------------------------
  it("oversized: file > 10 MB → 413 BRIEF_TOO_LARGE, no DB + no Storage writes", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu3a" });
    const big = new Blob([new Uint8Array(BRIEF_MAX_BYTES + 1)], { type: "text/markdown" });
    const res = await uploadBriefPOST(makeMultipartRequest({ siteId, file: big }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BRIEF_TOO_LARGE");

    const svc = getServiceRoleClient();
    const briefs = await svc.from("briefs").select("id").eq("site_id", siteId);
    expect(briefs.data).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 4. Validation: missing site_id
  // -----------------------------------------------------------------------
  it("missing site_id → 400 VALIDATION_FAILED", async () => {
    const req = makeMultipartRequest({ siteId: null });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  // -----------------------------------------------------------------------
  // 5. Missing file
  // -----------------------------------------------------------------------
  it("missing file → 400 VALIDATION_FAILED", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu5a" });
    const res = await uploadBriefPOST(makeMultipartRequest({ siteId, file: null }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  // -----------------------------------------------------------------------
  // 6. Unsupported MIME
  // -----------------------------------------------------------------------
  it("PDF upload → 415 BRIEF_UNSUPPORTED_TYPE", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu6a" });
    const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const res = await uploadBriefPOST(makeMultipartRequest({ siteId, file: pdf, fileName: "x.pdf" }));
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BRIEF_UNSUPPORTED_TYPE");
  });

  // -----------------------------------------------------------------------
  // 7. Idempotency key conflict
  // -----------------------------------------------------------------------
  it("same idempotency_key + different SHA → 422 IDEMPOTENCY_KEY_CONFLICT", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu7a" });
    const key = `client-key-${Math.random().toString(36).slice(2, 10)}`;

    const first = await uploadBriefPOST(makeMultipartRequest({ siteId, idempotencyKey: key }));
    expect(first.status).toBe(201);

    const differentBlob = new Blob(["## Different\n\nThis is a different file."], { type: "text/markdown" });
    const second = await uploadBriefPOST(makeMultipartRequest({ siteId, file: differentBlob, idempotencyKey: key }));
    expect(second.status).toBe(422);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  // -----------------------------------------------------------------------
  // 8. Site not found
  // -----------------------------------------------------------------------
  it("unknown site_id → 404 NOT_FOUND", async () => {
    const res = await uploadBriefPOST(
      makeMultipartRequest({ siteId: "11111111-2222-3333-4444-555555555555" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // -----------------------------------------------------------------------
  // 9. UAT-smoke-1: paste_text source mode
  // -----------------------------------------------------------------------
  it("paste_text path: raw markdown text → 201 with parsed status, default title 'Pasted brief'", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu9a" });
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("paste_text", STRUCTURAL_MD);
    const req = new Request("http://localhost/api/briefs/upload", {
      method: "POST",
      body: form,
    });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      ok: boolean;
      data?: { brief_id: string; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe("parsed");

    const svc = getServiceRoleClient();
    const brief = await svc
      .from("briefs")
      .select("title, source_mime_type, content_type")
      .eq("id", body.data!.brief_id)
      .single();
    expect(brief.error).toBeNull();
    expect(brief.data?.title).toBe("Pasted brief");
    expect(brief.data?.source_mime_type).toBe("text/markdown");
    expect(brief.data?.content_type).toBe("page"); // default
  });

  it("paste_text path: explicit content_type='post' → brief row has content_type 'post'", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu9b" });
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("paste_text", STRUCTURAL_MD);
    form.append("content_type", "post");
    form.append("title", "My posts brief");
    const req = new Request("http://localhost/api/briefs/upload", {
      method: "POST",
      body: form,
    });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { brief_id: string } };
    const svc = getServiceRoleClient();
    const brief = await svc
      .from("briefs")
      .select("title, content_type")
      .eq("id", body.data.brief_id)
      .single();
    expect(brief.data?.title).toBe("My posts brief");
    expect(brief.data?.content_type).toBe("post");
  });

  it("paste_text path: empty paste with no file → 400 VALIDATION_FAILED", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu9c" });
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("paste_text", "   \n\n  "); // whitespace only
    const req = new Request("http://localhost/api/briefs/upload", {
      method: "POST",
      body: form,
    });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("file path with content_type='post' → brief row has content_type 'post'", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu9d" });
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("content_type", "post");
    form.append(
      "file",
      new Blob([STRUCTURAL_MD], { type: "text/markdown" }),
      "brief.md",
    );
    const req = new Request("http://localhost/api/briefs/upload", {
      method: "POST",
      body: form,
    });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { brief_id: string } };
    const svc = getServiceRoleClient();
    const brief = await svc
      .from("briefs")
      .select("content_type")
      .eq("id", body.data.brief_id)
      .single();
    expect(brief.data?.content_type).toBe("post");
  });

  it("unrecognised content_type values silently default to 'page'", async () => {
    const { id: siteId } = await seedSite({ prefix: "mu9e" });
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("content_type", "garbage");
    form.append(
      "file",
      new Blob([STRUCTURAL_MD], { type: "text/markdown" }),
      "brief.md",
    );
    const req = new Request("http://localhost/api/briefs/upload", {
      method: "POST",
      body: form,
    });
    const res = await uploadBriefPOST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: { brief_id: string } };
    const svc = getServiceRoleClient();
    const brief = await svc
      .from("briefs")
      .select("content_type")
      .eq("id", body.data.brief_id)
      .single();
    expect(brief.data?.content_type).toBe("page");
  });
});
