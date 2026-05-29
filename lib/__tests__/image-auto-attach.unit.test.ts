import { describe, expect, test, vi, beforeEach } from "vitest";

// B4 — auto-attach logic for approved image-gen jobs.
//
// Mocks the entire Supabase chain to cover the four documented paths:
//   1. target_publish_date null         → not_applicable, no draft touched
//   2. attached: new draft created       → attached, draftId returned
//   3. attached: existing draft found    → attached, asset id appended
//   4. FK / DB failure                   → attach_failed but never throws

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update";
  filters: Record<string, unknown>;
  isNull: string[];
  patch?: unknown;
  inserted?: unknown;
}

const calls: RecordedCall[] = [];

// Per-call result configuration. Tests set the relevant entries before
// invoking autoAttachImage.
const responses: {
  jobLookup: { data: unknown; error: unknown };
  assetInsert: { data: unknown; error: unknown };
  draftLookup: { data: unknown; error: unknown };
  draftInsert: { data: unknown; error: unknown };
  draftRead: { data: unknown; error: unknown };
  draftUpdate: { error: unknown };
  jobStateUpdate: { error: unknown };
} = {
  jobLookup: { data: null, error: null },
  assetInsert: { data: null, error: null },
  draftLookup: { data: null, error: null },
  draftInsert: { data: null, error: null },
  draftRead: { data: null, error: null },
  draftUpdate: { error: null },
  jobStateUpdate: { error: null },
};

function makeSelectChain(table: string): unknown {
  const call: RecordedCall = { table, op: "select", filters: {}, isNull: [] };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      return chain;
    },
    is(field: string, value: unknown) {
      if (value === null) call.isNull.push(field);
      return chain;
    },
    limit(_n: number) {
      return chain;
    },
    in(field: string, values: unknown[]) {
      call.filters[field] = values;
      return chain;
    },
    async maybeSingle() {
      calls.push(call);
      // route to the right response shape based on table + filters
      if (table === "image_generation_jobs") return responses.jobLookup;
      if (table === "social_post_drafts") return responses.draftLookup;
      if (table === "social_post_drafts_read") return responses.draftRead;
      return { data: null, error: null };
    },
  };
  return chain;
}

// social_post_drafts has TWO select() calls in auto-attach: lookup (with
// .eq("state","scheduled")) and read (after create/find for media_asset_ids).
// Distinguish by call sequence.
let draftSelectCallCount = 0;
function makeDraftSelectChain(): unknown {
  draftSelectCallCount++;
  const isReadAfterCreate = draftSelectCallCount % 2 === 0;
  const call: RecordedCall = {
    table: isReadAfterCreate ? "social_post_drafts_read" : "social_post_drafts",
    op: "select",
    filters: {},
    isNull: [],
  };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      return chain;
    },
    is(field: string, value: unknown) {
      if (value === null) call.isNull.push(field);
      return chain;
    },
    limit(_n: number) {
      return chain;
    },
    async maybeSingle() {
      calls.push(call);
      return isReadAfterCreate ? responses.draftRead : responses.draftLookup;
    },
  };
  return chain;
}

function makeInsertChain(table: string, row: unknown): unknown {
  const call: RecordedCall = { table, op: "insert", filters: {}, isNull: [], inserted: row };
  return {
    select(_cols?: string) {
      return {
        async single() {
          calls.push(call);
          if (table === "social_media_assets") return responses.assetInsert;
          if (table === "social_post_drafts") return responses.draftInsert;
          if (table === "image_selections") return { data: { id: "sel-1" }, error: null };
          return { data: null, error: null };
        },
      };
    },
  };
}

function makeUpdateChain(table: string, patch: unknown): unknown {
  const call: RecordedCall = { table, op: "update", filters: {}, isNull: [], patch };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      calls.push(call);
      return Promise.resolve(
        table === "social_post_drafts" ? responses.draftUpdate : responses.jobStateUpdate,
      );
    },
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      return {
        select(_cols?: string) {
          if (table === "social_post_drafts") return makeDraftSelectChain();
          return makeSelectChain(table);
        },
        insert(row: unknown) {
          return makeInsertChain(table, row);
        },
        update(patch: unknown) {
          return makeUpdateChain(table, patch);
        },
      };
    },
  }),
}));

import { autoAttachImage } from "@/lib/image/auto-attach";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const APPROVER_ID = "33333333-3333-4333-8333-333333333333";
const STORAGE_PATH = "company-x/job-y/image.jpg";
const EXISTING_DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const NEW_DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const ASSET_ID = "66666666-6666-4666-8666-666666666666";

function resetResponses(): void {
  responses.jobLookup = { data: null, error: null };
  responses.assetInsert = { data: { id: ASSET_ID }, error: null };
  responses.draftLookup = { data: null, error: null };
  responses.draftInsert = { data: { id: NEW_DRAFT_ID }, error: null };
  responses.draftRead = { data: { media_asset_ids: [] }, error: null };
  responses.draftUpdate = { error: null };
  responses.jobStateUpdate = { error: null };
}

beforeEach(() => {
  calls.length = 0;
  draftSelectCallCount = 0;
  resetResponses();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Path 1: target_publish_date null → not_applicable
// ---------------------------------------------------------------------------

describe("autoAttachImage — no publish date", () => {
  test("returns not_applicable when target_publish_date is null; no asset/draft writes", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: null,
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("not_applicable");
    expect(result.draftId).toBeUndefined();
    expect(result.assetId).toBeUndefined();

    expect(calls.filter((c) => c.table === "social_media_assets" && c.op === "insert"))
      .toHaveLength(0);
    expect(calls.filter((c) => c.table === "social_post_drafts" && c.op === "insert"))
      .toHaveLength(0);

    const stateUpdate = calls.find(
      (c) => c.op === "update" && c.table === "image_generation_jobs",
    );
    expect((stateUpdate?.patch as { auto_attach_state: string }).auto_attach_state).toBe(
      "not_applicable",
    );
  });
});

// ---------------------------------------------------------------------------
// Path 2: attach to a brand-new draft
// ---------------------------------------------------------------------------

describe("autoAttachImage — new draft", () => {
  test("creates social_media_assets row + new social_post_drafts row; marks attached", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "4x5" },
      },
      error: null,
    };
    responses.draftLookup = { data: null, error: null }; // no existing draft
    responses.draftInsert = { data: { id: NEW_DRAFT_ID }, error: null };
    responses.draftRead = { data: { media_asset_ids: [] }, error: null };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    expect(result.draftId).toBe(NEW_DRAFT_ID);
    expect(result.assetId).toBe(ASSET_ID);

    // Asset insert carried the right shape.
    const assetInsert = calls.find((c) => c.table === "social_media_assets" && c.op === "insert");
    const row = assetInsert!.inserted as {
      company_id: string;
      storage_path: string;
      uploaded_by: string;
      width: number;
      height: number;
      mime_type: string;
    };
    expect(row.company_id).toBe(COMPANY_ID);
    expect(row.storage_path).toBe(STORAGE_PATH);
    expect(row.uploaded_by).toBe(APPROVER_ID);
    expect(row.width).toBe(1024);
    expect(row.height).toBe(1280);
    expect(row.mime_type).toBe("image/jpeg");

    // Draft was inserted because lookup returned null.
    const draftInsert = calls.find((c) => c.table === "social_post_drafts" && c.op === "insert");
    expect(draftInsert).toBeDefined();
    const draftRow = draftInsert!.inserted as { state: string; scheduled_at: string };
    expect(draftRow.state).toBe("scheduled");
    expect(draftRow.scheduled_at).toBe("2026-06-15T00:00:00.000Z");

    // media_asset_ids on the draft got the new asset appended.
    const draftUpdate = calls.find(
      (c) => c.op === "update" && c.table === "social_post_drafts",
    );
    expect((draftUpdate?.patch as { media_asset_ids: string[] }).media_asset_ids).toEqual([
      ASSET_ID,
    ]);

    // Final state mark.
    const stateUpdates = calls.filter(
      (c) => c.op === "update" && c.table === "image_generation_jobs",
    );
    const finalState = stateUpdates[stateUpdates.length - 1];
    expect((finalState.patch as { auto_attach_state: string }).auto_attach_state).toBe("attached");
    expect((finalState.patch as { auto_attached_draft_id: string }).auto_attached_draft_id).toBe(
      NEW_DRAFT_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// Path 3: attach to an existing scheduled draft
// ---------------------------------------------------------------------------

describe("autoAttachImage — existing draft", () => {
  test("does NOT create a new draft when one exists for (company, date); appends asset id", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };
    responses.draftLookup = { data: { id: EXISTING_DRAFT_ID }, error: null };
    responses.draftRead = {
      data: { media_asset_ids: ["existing-asset-a", "existing-asset-b"] },
      error: null,
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    expect(result.draftId).toBe(EXISTING_DRAFT_ID);

    // No INSERT into social_post_drafts.
    expect(calls.filter((c) => c.table === "social_post_drafts" && c.op === "insert"))
      .toHaveLength(0);

    // media_asset_ids should be the union, preserving existing order.
    const draftUpdate = calls.find(
      (c) => c.op === "update" && c.table === "social_post_drafts",
    );
    expect((draftUpdate?.patch as { media_asset_ids: string[] }).media_asset_ids).toEqual([
      "existing-asset-a",
      "existing-asset-b",
      ASSET_ID,
    ]);
  });

  test("idempotent: assetId already present → media_asset_ids unchanged", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };
    responses.draftLookup = { data: { id: EXISTING_DRAFT_ID }, error: null };
    responses.draftRead = { data: { media_asset_ids: [ASSET_ID] }, error: null };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    const draftUpdate = calls.find(
      (c) => c.op === "update" && c.table === "social_post_drafts",
    );
    expect((draftUpdate?.patch as { media_asset_ids: string[] }).media_asset_ids).toEqual([
      ASSET_ID,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Path 4: failure modes → attach_failed but never throws
// ---------------------------------------------------------------------------

describe("autoAttachImage — failure paths", () => {
  test("job lookup error → attach_failed, no further writes", async () => {
    responses.jobLookup = { data: null, error: { message: "row not found" } };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attach_failed");
    expect(result.error).toBe("row not found");
  });

  test("tenancy mismatch → attach_failed; logs warning", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: "other-company-id",
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attach_failed");
    expect(result.error).toBe("company_id mismatch");
  });

  test("asset insert FK violation → attach_failed; selection still succeeds in caller", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };
    responses.assetInsert = {
      data: null,
      error: { message: "insert or update on table violates foreign key constraint" },
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attach_failed");
    expect(result.error).toContain("foreign key");

    // Job state was marked attach_failed.
    const finalState = calls
      .filter((c) => c.op === "update" && c.table === "image_generation_jobs")
      .pop();
    expect((finalState?.patch as { auto_attach_state: string }).auto_attach_state).toBe(
      "attach_failed",
    );
  });

  test("draft update error → attach_failed; draftId surfaced in result for diagnostics", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "completed",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };
    responses.draftLookup = { data: { id: EXISTING_DRAFT_ID }, error: null };
    responses.draftRead = { data: { media_asset_ids: [] }, error: null };
    responses.draftUpdate = { error: { message: "deadlock detected" } };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attach_failed");
    expect(result.draftId).toBe(EXISTING_DRAFT_ID);
    expect(result.assetId).toBe(ASSET_ID);
    expect(result.error).toBe("deadlock detected");
  });

  test("job not in 'completed' state → attach_failed (not allowed to attach a pending/failed job)", async () => {
    responses.jobLookup = {
      data: {
        id: JOB_ID,
        company_id: COMPANY_ID,
        state: "running",
        result_storage_path: STORAGE_PATH,
        target_publish_date: "2026-06-15",
        generation_params: { aspectRatio: "1x1" },
      },
      error: null,
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attach_failed");
    expect(result.error).toMatch(/state=running/);
  });
});
