import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commitBrief,
  computePageHash,
  type BriefRow,
  type BriefPageRow,
} from "@/lib/briefs";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-1 — POST /api/briefs/[brief_id]/commit integration tests.
//
// Runs with FEATURE_SUPABASE_AUTH off so the admin gate allows; the
// actual business logic lives in lib/briefs.commitBrief. We exercise
// both the route (one happy-path call) and commitBrief directly for
// the idempotency / version-conflict permutations.
// ---------------------------------------------------------------------------

vi.mock("@/lib/anthropic-call", async () => {
  const actual = await vi.importActual<typeof import("@/lib/anthropic-call")>(
    "@/lib/anthropic-call",
  );
  return {
    ...actual,
    defaultAnthropicCall: vi.fn(async () => ({
      id: "stub",
      model: "claude-sonnet-4-6",
      content: [{ type: "text" as const, text: "[]" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    })),
  };
});

import { POST as uploadBriefPOST } from "@/app/api/briefs/upload/route";
import { POST as commitBriefPOST } from "@/app/api/briefs/[brief_id]/commit/route";

const STRUCTURAL = `## Home

Home copy here.

## About

About copy.

## Pricing

Pricing copy.
`;

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let origEnv: Record<string, string | undefined>;

beforeEach(() => {
  origEnv = {};
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  delete process.env.FEATURE_SUPABASE_AUTH;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
});

async function seedParsedBrief(siteId: string): Promise<{ briefId: string }> {
  const form = new FormData();
  form.append("site_id", siteId);
  form.append("file", new Blob([STRUCTURAL], { type: "text/markdown" }), "brief.md");
  const res = await uploadBriefPOST(
    new Request("http://localhost/api/briefs/upload", { method: "POST", body: form }),
  );
  const body = (await res.json()) as { data: { brief_id: string } };
  return { briefId: body.data.brief_id };
}

async function getBriefAndPages(briefId: string): Promise<{ brief: BriefRow; pages: BriefPageRow[] }> {
  const svc = getServiceRoleClient();
  const brief = await svc.from("briefs").select("*").eq("id", briefId).single();
  const pages = await svc
    .from("brief_pages")
    .select("*")
    .eq("brief_id", briefId)
    .order("ordinal", { ascending: true });
  return { brief: brief.data as BriefRow, pages: (pages.data ?? []) as BriefPageRow[] };
}

describe("POST /api/briefs/[brief_id]/commit", () => {
  it("happy path: parsed → committed + committed_at and committed_page_hash set", async () => {
    const { id: siteId } = await seedSite({ prefix: "mc1a" });
    const { briefId } = await seedParsedBrief(siteId);
    const { brief, pages } = await getBriefAndPages(briefId);
    const pageHash = computePageHash(pages);

    const req = new Request(`http://localhost/api/briefs/${briefId}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_version_lock: brief.version_lock,
        page_hash: pageHash,
      }),
    });
    const res = await commitBriefPOST(req, { params: { brief_id: briefId } });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; data?: { replay: boolean; committed_page_hash: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.replay).toBe(false);
    expect(body.data?.committed_page_hash).toBe(pageHash);

    const svc = getServiceRoleClient();
    const after = await svc.from("briefs").select("status, committed_at, committed_page_hash, version_lock").eq("id", briefId).single();
    expect(after.data?.status).toBe("committed");
    expect(after.data?.committed_at).not.toBeNull();
    expect(after.data?.committed_page_hash).toBe(pageHash);
    expect(after.data?.version_lock).toBe(brief.version_lock + 1);
  });

  it("replay: same page_hash after commit → 200 with replay=true", async () => {
    const { id: siteId } = await seedSite({ prefix: "mc2a" });
    const { briefId } = await seedParsedBrief(siteId);
    const { brief, pages } = await getBriefAndPages(briefId);
    const pageHash = computePageHash(pages);

    const first = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock,
      pageHash,
      committedBy: null,
    });
    expect(first.ok).toBe(true);

    const replay = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock + 1, // ignored on replay path
      pageHash,
      committedBy: null,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.data.replay).toBe(true);
      expect(replay.data.committed_page_hash).toBe(pageHash);
    }
  });

  it("version conflict: stale version_lock → VERSION_CONFLICT", async () => {
    const { id: siteId } = await seedSite({ prefix: "mc3a" });
    const { briefId } = await seedParsedBrief(siteId);
    const { brief, pages } = await getBriefAndPages(briefId);
    const pageHash = computePageHash(pages);

    // Concurrent operator edit bumped version_lock before this commit.
    const svc = getServiceRoleClient();
    await svc.from("briefs").update({ version_lock: brief.version_lock + 5 }).eq("id", briefId);

    const result = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock,
      pageHash,
      committedBy: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VERSION_CONFLICT");
  });

  it("hash mismatch: page_hash ≠ server state → VERSION_CONFLICT", async () => {
    const { id: siteId } = await seedSite({ prefix: "mc4a" });
    const { briefId } = await seedParsedBrief(siteId);
    const { brief } = await getBriefAndPages(briefId);

    const result = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock,
      pageHash: "f".repeat(64),
      committedBy: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VERSION_CONFLICT");
  });

  it("double commit with different page_hash → ALREADY_EXISTS", async () => {
    const { id: siteId } = await seedSite({ prefix: "mc5a" });
    const { briefId } = await seedParsedBrief(siteId);
    const { brief, pages } = await getBriefAndPages(briefId);
    const pageHash = computePageHash(pages);

    const first = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock,
      pageHash,
      committedBy: null,
    });
    expect(first.ok).toBe(true);

    const second = await commitBrief({
      briefId,
      expectedVersionLock: brief.version_lock + 1,
      pageHash: "0".repeat(64),
      committedBy: null,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("ALREADY_EXISTS");
  });
});
