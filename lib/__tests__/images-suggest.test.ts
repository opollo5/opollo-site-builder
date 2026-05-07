import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as suggestPOST } from "@/app/api/images/suggest/route";

// ---------------------------------------------------------------------------
// Spec 05 — /api/images/suggest endpoint integration tests.
//
// Strategy:
//   1. Seed a tiny image set with known captions and pre-computed (mock)
//      embeddings.
//   2. Hit the route directly with a constructed NextRequest.
//   3. Assert the top result matches the seeded ground-truth.
//
// Embeddings are mocked at the lib/images/embed module boundary — we
// don't want CI burning OpenAI credits on every run. The mock returns a
// deterministic sparse vector so the cosine math is well-defined.
// ---------------------------------------------------------------------------

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: async () => ({
    kind: "allow",
    user: { id: "00000000-0000-0000-0000-000000000001" },
  }),
}));

vi.mock("@/lib/cloudflare-images", () => ({
  deliveryUrl: (cfId: string) => `https://imagedelivery.net/test/${cfId}/public`,
}));

vi.mock("@/lib/images/embed", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/images/embed")
  >("@/lib/images/embed");
  return {
    ...actual,
    embedText: vi.fn(async (input: string): Promise<number[]> => {
      // Deterministic 1536-dim vector keyed off the input's hash. Two calls
      // with the same input return the same vector; different inputs return
      // different vectors. Exact values don't matter for the test — we
      // mostly verify the route accepts the vector and the SQL runs.
      const seed = input
        .split("")
        .reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
      const vec = new Array<number>(1536);
      let x = seed || 1;
      for (let i = 0; i < 1536; i++) {
        x = Math.imul(x, 48271) >>> 0;
        vec[i] = ((x % 1000) - 500) / 1000;
      }
      return vec;
    }),
  };
});

import { getServiceRoleClient } from "@/lib/supabase";

// IDs are valid RFC 4122 v4 UUIDs (version=4, variant=8) so they pass
// strict UUID validation — pattern `xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`.
const SEEDED_IMAGES = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    cloudflare_id: "test/phishing",
    filename: "istock-phishing-attack.jpg",
    title: "Phishing email warning illustration",
    caption: "A laptop screen showing a phishing email attempt with red warning indicators.",
    alt_text: "Phishing email on laptop with warning",
    tags: ["phishing", "cybersecurity", "email", "fraud"],
    source: "istock",
    source_ref: "phishing-1",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    cloudflare_id: "test/office",
    filename: "istock-office-meeting.jpg",
    title: "Two coworkers in modern office",
    caption: "Two business professionals collaborating at a desk in a modern open-plan office.",
    alt_text: "Coworkers in office meeting",
    tags: ["office", "business", "meeting"],
    source: "istock",
    source_ref: "office-1",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    cloudflare_id: "test/hacker",
    filename: "istock-hooded-hacker.jpg",
    title: "Hooded figure at laptop",
    caption: "A hooded figure typing on a laptop in a dark room — generic hacker stock photo.",
    alt_text: "Hooded hacker at laptop",
    tags: ["hacker", "cyber", "security", "dark"],
    source: "istock",
    source_ref: "hacker-1",
  },
];

let createdImageIds: string[] = [];

async function seedImages(): Promise<void> {
  const svc = getServiceRoleClient();
  // Use insert + select id so we can clean up later.
  const { data, error } = await svc
    .from("image_library")
    .insert(SEEDED_IMAGES)
    .select("id");
  if (error) throw new Error(`Seed failed: ${error.message}`);
  createdImageIds = (data ?? []).map((r) => r.id as string);
  expect(createdImageIds.length).toBe(SEEDED_IMAGES.length);
}

// Persist a deterministic mock embedding for one seeded image so cosine
// similarity is meaningful when the route's mocked embedText returns a
// vector for similar text.
async function setEmbedding(id: string, source: string): Promise<void> {
  const seed = source
    .split("")
    .reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const vec = new Array<number>(1536);
  let x = seed || 1;
  for (let i = 0; i < 1536; i++) {
    x = Math.imul(x, 48271) >>> 0;
    vec[i] = ((x % 1000) - 500) / 1000;
  }
  const literal = `[${vec.join(",")}]`;
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("image_library")
    .update({ caption_embedding: literal })
    .eq("id", id);
  if (error) throw new Error(`Embedding write failed: ${error.message}`);
}

// _setup.ts truncates image_library between every test, so seed inside
// beforeEach (post-truncate) rather than beforeAll. Each test starts with
// a fresh, fully-populated set including embeddings.
beforeEach(async () => {
  await seedImages();
  // Mirror the embedding-input composition the suggest route uses for
  // queries. For each seeded image, write an embedding derived from the
  // same kind of text so cosine similarity is meaningful.
  for (const img of SEEDED_IMAGES) {
    await setEmbedding(
      img.id,
      `${img.title}. ${img.caption}. Tags: ${img.tags.join(", ")}.`,
    );
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/images/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/images/suggest", () => {
  it("returns empty result + keywordOnly when no title or body", async () => {
    const res = await suggestPOST(makePost({}) as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.images).toEqual([]);
    expect(json.data.keywordOnly).toBe(true);
  });

  it("ranks the phishing image first for a phishing-themed post", async () => {
    const res = await suggestPOST(
      makePost({
        postTitle: "How to spot a phishing email",
        postBody:
          "Phishing emails try to trick employees into clicking malicious links and handing over credentials. Look for these red flags in your inbox.",
        limit: 3,
      }) as never,
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.images.length).toBeGreaterThan(0);
    const top = json.data.images[0];
    // Phishing image should rank first via the keyword side; the semantic
    // side reinforces it because we seeded its embedding from text that
    // includes "phishing".
    expect(top.caption).toContain("phishing");
  });

  it("excludes images via excludeIds", async () => {
    const phishingId = createdImageIds[0];
    const res = await suggestPOST(
      makePost({
        postTitle: "Phishing emails",
        postBody: "phishing fraud cybersecurity",
        excludeIds: [phishingId],
        limit: 3,
      }) as never,
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    const ids = json.data.images.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(phishingId);
  });

  it("falls back to keyword-only when query embedding fails", async () => {
    const embedMod = await import("@/lib/images/embed");
    const spy = vi
      .spyOn(embedMod, "embedText")
      .mockRejectedValueOnce(new embedMod.EmbeddingNotConfiguredError());
    const res = await suggestPOST(
      makePost({
        postTitle: "Phishing email basics",
        postBody: "fraud",
        limit: 3,
      }) as never,
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.queryEmbedded).toBe(false);
    expect(json.data.keywordOnly).toBe(true);
    expect(json.data.images.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
