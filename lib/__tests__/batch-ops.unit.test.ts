import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// batch-ops unit tests
//
// Tests for deleteBatch and resetApprovalToFresh in lib/image/batch-ops.ts.
// Uses a fluent mock of getServiceRoleClient to record which tables and
// operations are called without hitting a real DB.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tracked call recording
// ─────────────────────────────────────────────────────────────────────────────

interface Op {
  table: string;
  method: "select" | "update" | "delete";
  filters: Record<string, unknown>;
  patch?: unknown;
  inFilters?: Record<string, unknown>;
  isNullFields?: string[];
}

let ops: Op[] = [];

// Per-table response overrides. Tests can set these before invoking.
type TableResponse = { data: unknown; error: unknown };

const responses: Record<string, TableResponse> = {};

function defaultResponse(table: string): TableResponse {
  if (table === "image_generation_jobs") {
    return {
      data: [
        { id: JOB_ID_1, auto_attached_draft_id: DRAFT_ID },
        { id: JOB_ID_2, auto_attached_draft_id: null },
      ],
      error: null,
    };
  }
  if (table === "social_approval_requests") {
    return {
      data: [{ id: APPROVAL_REQ_ID }],
      error: null,
    };
  }
  return { data: [], error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock chain builders
// ─────────────────────────────────────────────────────────────────────────────

function makeSelectChain(table: string): unknown {
  const op: Op = { table, method: "select", filters: {}, inFilters: {}, isNullFields: [] };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      op.filters[field] = value;
      return chain;
    },
    in(field: string, values: unknown[]) {
      (op.inFilters as Record<string, unknown>)[field] = values;
      return chain;
    },
    is(field: string, _value: unknown) {
      (op.isNullFields as string[]).push(field);
      return chain;
    },
    order() {
      return chain;
    },
    async single() {
      ops.push(op);
      return responses[table] ?? defaultResponse(table);
    },
    async maybeSingle() {
      ops.push(op);
      return responses[table] ?? defaultResponse(table);
    },
    then(resolve: (v: unknown) => unknown) {
      ops.push(op);
      return Promise.resolve(responses[table] ?? defaultResponse(table)).then(resolve);
    },
  };
  // Make the chain thenable so `await svc.from(t).select(...).eq(...).is(...)` works
  // when there's no terminal call like single() / maybeSingle().
  return new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => chain;
    },
  });
}

function makeUpdateChain(table: string, patch: unknown): unknown {
  const op: Op = { table, method: "update", filters: {}, patch, inFilters: {}, isNullFields: [] };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      op.filters[field] = value;
      return chain;
    },
    in(field: string, values: unknown[]) {
      (op.inFilters as Record<string, unknown>)[field] = values;
      return chain;
    },
    is(field: string, _value: unknown) {
      (op.isNullFields as string[]).push(field);
      return chain;
    },
    then(resolve: (v: unknown) => unknown) {
      ops.push(op);
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => chain;
    },
  });
}

function makeDeleteChain(table: string): unknown {
  const op: Op = { table, method: "delete", filters: {}, inFilters: {} };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      op.filters[field] = value;
      return chain;
    },
    in(field: string, values: unknown[]) {
      (op.inFilters as Record<string, unknown>)[field] = values;
      return chain;
    },
    then(resolve: (v: unknown) => unknown) {
      ops.push(op);
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return new Proxy(chain, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => chain;
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from(table: string) {
      return {
        select(_cols?: string) {
          return makeSelectChain(table);
        },
        update(patch: unknown) {
          return makeUpdateChain(table, patch);
        },
        delete() {
          return makeDeleteChain(table);
        },
      };
    },
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_ID_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB_ID_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DRAFT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const APPROVAL_REQ_ID = "11111111-1111-4111-8111-111111111111";

// ─────────────────────────────────────────────────────────────────────────────
// Import under test (after mocks are registered)
// ─────────────────────────────────────────────────────────────────────────────

import { deleteBatch, resetApprovalToFresh } from "@/lib/image/batch-ops";

// ─────────────────────────────────────────────────────────────────────────────
// deleteBatch
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteBatch", () => {
  beforeEach(() => {
    ops = [];
    Object.keys(responses).forEach((k) => delete responses[k]);
  });

  it("calls select on image_generation_jobs to find job IDs", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const jobSelect = ops.find(
      (o) => o.table === "image_generation_jobs" && o.method === "select",
    );
    expect(jobSelect).toBeDefined();
    expect(jobSelect?.filters["batch_id"]).toBe(BATCH_ID);
    expect(jobSelect?.filters["company_id"]).toBe(COMPANY_ID);
  });

  it("soft-deletes attached social_post_drafts", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const draftUpdate = ops.find(
      (o) => o.table === "social_post_drafts" && o.method === "update",
    );
    expect(draftUpdate).toBeDefined();
    const patch = draftUpdate?.patch as Record<string, unknown>;
    expect(patch["archived_at"]).toBeDefined();
    expect(patch["updated_by"]).toBe(ACTOR_ID);
    // The in-filter must include the draft ID returned by the jobs lookup.
    expect(draftUpdate?.inFilters?.["id"]).toContain(DRAFT_ID);
    // Must also scope to company_id.
    expect(draftUpdate?.filters["company_id"]).toBe(COMPANY_ID);
  });

  it("revokes approval recipients for the batch", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const recipientRevoke = ops.find(
      (o) => o.table === "social_approval_recipients" && o.method === "update",
    );
    expect(recipientRevoke).toBeDefined();
    const patch = recipientRevoke?.patch as Record<string, unknown>;
    expect(patch["revoked_at"]).toBeDefined();
    expect(recipientRevoke?.inFilters?.["approval_request_id"]).toContain(APPROVAL_REQ_ID);
  });

  it("hard-deletes image_selections for the batch jobs", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const selDelete = ops.find(
      (o) => o.table === "image_selections" && o.method === "delete",
    );
    expect(selDelete).toBeDefined();
    const jobIds = selDelete?.inFilters?.["job_id"] as string[];
    expect(jobIds).toContain(JOB_ID_1);
    expect(jobIds).toContain(JOB_ID_2);
  });

  it("hard-deletes image_generation_jobs scoped to batch and company", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const jobDelete = ops.find(
      (o) => o.table === "image_generation_jobs" && o.method === "delete",
    );
    expect(jobDelete).toBeDefined();
    expect(jobDelete?.filters["batch_id"]).toBe(BATCH_ID);
    expect(jobDelete?.filters["company_id"]).toBe(COMPANY_ID);
  });

  it("hard-deletes the batch row scoped to company", async () => {
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const batchDelete = ops.find(
      (o) => o.table === "image_generation_batches" && o.method === "delete",
    );
    expect(batchDelete).toBeDefined();
    expect(batchDelete?.filters["id"]).toBe(BATCH_ID);
    expect(batchDelete?.filters["company_id"]).toBe(COMPANY_ID);
  });

  it("does not throw even when the jobs lookup returns an error (fail-soft)", async () => {
    responses["image_generation_jobs"] = {
      data: null,
      error: { message: "DB connection lost" },
    };
    await expect(deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID)).resolves.toBeUndefined();
  });

  it("does not include null draft IDs in the draft soft-delete", async () => {
    // JOB_ID_2 has auto_attached_draft_id: null — must not appear in the in-filter.
    await deleteBatch(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const draftUpdate = ops.find(
      (o) => o.table === "social_post_drafts" && o.method === "update",
    );
    const ids = draftUpdate?.inFilters?.["id"] as string[] | undefined;
    expect(ids).not.toContain(null);
    expect(ids).not.toContain(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetApprovalToFresh
// ─────────────────────────────────────────────────────────────────────────────

describe("resetApprovalToFresh", () => {
  beforeEach(() => {
    ops = [];
    Object.keys(responses).forEach((k) => delete responses[k]);
  });

  it("resets approval_status and review_round on the batch", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const batchUpdate = ops.find(
      (o) => o.table === "image_generation_batches" && o.method === "update",
    );
    expect(batchUpdate).toBeDefined();
    const patch = batchUpdate?.patch as Record<string, unknown>;
    expect(patch["approval_status"]).toBe("none");
    expect(patch["review_round"]).toBe(0);
    expect(batchUpdate?.filters["id"]).toBe(BATCH_ID);
    expect(batchUpdate?.filters["company_id"]).toBe(COMPANY_ID);
  });

  it("resets auto_attach_state and auto_attached_draft_id on jobs", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const jobUpdate = ops.find(
      (o) =>
        o.table === "image_generation_jobs" &&
        o.method === "update" &&
        (o.patch as Record<string, unknown>)["auto_attach_state"] === null,
    );
    expect(jobUpdate).toBeDefined();
    const patch = jobUpdate?.patch as Record<string, unknown>;
    expect(patch["auto_attached_draft_id"]).toBeNull();
    expect(jobUpdate?.filters["batch_id"]).toBe(BATCH_ID);
  });

  it("clears image_selections for all jobs", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const selDelete = ops.find(
      (o) => o.table === "image_selections" && o.method === "delete",
    );
    expect(selDelete).toBeDefined();
    const jobIds = selDelete?.inFilters?.["job_id"] as string[];
    expect(jobIds).toContain(JOB_ID_1);
  });

  it("does NOT hard-delete image_generation_jobs", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const jobDelete = ops.find(
      (o) => o.table === "image_generation_jobs" && o.method === "delete",
    );
    expect(jobDelete).toBeUndefined();
  });

  it("does NOT hard-delete image_generation_batches", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const batchDelete = ops.find(
      (o) => o.table === "image_generation_batches" && o.method === "delete",
    );
    expect(batchDelete).toBeUndefined();
  });

  it("revokes open approval requests for the batch", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const approvalRevoke = ops.find(
      (o) =>
        o.table === "social_approval_requests" &&
        o.method === "update" &&
        (o.patch as Record<string, unknown>)["revoked_at"] !== undefined,
    );
    expect(approvalRevoke).toBeDefined();
    expect(approvalRevoke?.inFilters?.["id"]).toContain(APPROVAL_REQ_ID);
  });

  it("soft-deletes attached drafts", async () => {
    await resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID);
    const draftUpdate = ops.find(
      (o) => o.table === "social_post_drafts" && o.method === "update",
    );
    expect(draftUpdate).toBeDefined();
    const patch = draftUpdate?.patch as Record<string, unknown>;
    expect(patch["archived_at"]).toBeDefined();
    expect(patch["updated_by"]).toBe(ACTOR_ID);
  });

  it("does not throw even when jobs lookup fails (fail-soft)", async () => {
    responses["image_generation_jobs"] = {
      data: null,
      error: { message: "network error" },
    };
    await expect(resetApprovalToFresh(BATCH_ID, COMPANY_ID, ACTOR_ID)).resolves.toBeUndefined();
  });
});
