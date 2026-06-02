/**
 * lib/__tests__/image-gate.unit.test.ts
 *
 * Phase 1 Step 3 — Workflow image_review gate intercept.
 *
 * Tests:
 *  1. autoAttachImage with gate disabled → draft state='scheduled', no approval request
 *  2. autoAttachImage with gate enabled  → draft state='draft', approval request created
 *  3. onGatePass: batch approval_status='approved', drafts set to ready_to_schedule
 *  4. onGateReject round 0→1: status='none', workflow_state='rework_image'
 *  5. onGateReject round 2→3: status='escalated_to_admin'
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// All state used inside vi.mock factories MUST be defined with vi.hoisted()
// because vitest moves vi.mock() calls before the rest of the file's code.
// ---------------------------------------------------------------------------

interface TableMockState {
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ patch: Record<string, unknown>; filters: Record<string, string> }>;
  selectResponse: { data: unknown; error: unknown };
  insertResponse: { data: unknown; error: unknown };
  updateResponse: { error: unknown };
}

const { tableState, makeTableMock } = vi.hoisted(() => {
  const tableState: Record<string, TableMockState> = {};

  function makeTableState(): TableMockState {
    return {
      inserts: [],
      updates: [],
      selectResponse: { data: null, error: null },
      insertResponse: { data: null, error: null },
      updateResponse: { error: null },
    };
  }

  function getState(table: string): TableMockState {
    if (!tableState[table]) {
      tableState[table] = makeTableState();
    }
    return tableState[table]!;
  }

  function makeTableMock(table: string) {
    // Select chain — thenable so code can await directly after .not()/.in().
    function makeSelectChain() {
      const st = getState(table);
      const chain = {
        eq(_field: string, _val: unknown) { return chain; },
        is(_field: string, _val: unknown) { return chain; },
        not(_field: string, _op: string, _val: unknown) { return chain; },
        in(_field: string, _vals: unknown[]) { return chain; },
        order(_field: string, _opts?: unknown) { return chain; },
        async maybeSingle() { return getState(table).selectResponse; },
        async single() { return getState(table).selectResponse; },
        then(
          resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) {
          Promise.resolve(getState(table).selectResponse).then(resolve, reject);
        },
      };
      return chain;
    }

    // Update chain — thenable, records patch + filters.
    function makeUpdateChain(patch: unknown) {
      const rec: { patch: Record<string, unknown>; filters: Record<string, string> } = {
        patch: patch as Record<string, unknown>,
        filters: {},
      };
      let captured = false;
      function capture() {
        if (!captured) {
          captured = true;
          getState(table).updates.push(rec);
        }
      }
      const chain = {
        eq(field: string, val: string) {
          rec.filters[field] = val;
          return chain;
        },
        in(_field: string, _vals: unknown[]) {
          capture();
          return chain;
        },
        then(
          resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) {
          capture();
          Promise.resolve(getState(table).updateResponse).then(resolve, reject);
        },
      };
      return chain;
    }

    return {
      select(_cols?: string) { return makeSelectChain(); },
      insert(row: unknown) {
        getState(table).inserts.push(row as Record<string, unknown>);
        return {
          select(_cols?: string) {
            return {
              single() { return Promise.resolve(getState(table).insertResponse); },
            };
          },
        };
      },
      update(patch: unknown) { return makeUpdateChain(patch); },
      delete() {
        return { eq(_field: string, _val: unknown) { return this; } };
      },
      upsert(row: unknown, _opts?: unknown) {
        getState(table).inserts.push(row as Record<string, unknown>);
        return {
          select(_cols?: string) {
            return {
              single() { return Promise.resolve(getState(table).insertResponse); },
            };
          },
        };
      },
    };
  }

  return { tableState, makeTableMock };
});

// ---------------------------------------------------------------------------
// Module mocks — registered before imports.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/platform/invitations/tokens", () => ({
  generateRawToken: vi.fn(() => "a".repeat(64)),
  hashToken: vi.fn((raw: string) => `hash-of-${raw}`),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from(table: string) { return makeTableMock(table); },
  })),
}));
vi.mock("@/lib/platform/workflow", () => ({
  getEnabledGate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_ID      = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID  = "22222222-2222-4222-8222-222222222222";
const BATCH_ID    = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID    = "44444444-4444-4444-8444-444444444444";
const ASSET_ID    = "55555555-5555-4555-8555-555555555555";
const APPROVER_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID  = "77777777-7777-4777-8777-777777777777";

const GATE_CONFIG = {
  id: "gate-uuid-1",
  companyId: COMPANY_ID,
  gateType: "image_review" as const,
  enabled: true,
  passRule: "any_one" as const,
  timeoutDays: 7,
  autoSchedule: true,
  approvers: [
    {
      id: "approver-uuid-1",
      gateId: "gate-uuid-1",
      platformUserId: APPROVER_ID,
      externalEmail: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState(table: string): TableMockState {
  if (!tableState[table]) {
    tableState[table] = {
      inserts: [],
      updates: [],
      selectResponse: { data: null, error: null },
      insertResponse: { data: null, error: null },
      updateResponse: { error: null },
    };
  }
  return tableState[table]!;
}

function resetTableState(): void {
  for (const key of Object.keys(tableState)) {
    delete tableState[key];
  }
}

/**
 * Set up the standard job + asset + draft + approval responses for auto-attach tests.
 */
function configureJobLookup(opts: { publishDate: string | null; state?: string } = { publishDate: "2026-06-15" }): void {
  getState("image_generation_jobs").selectResponse = {
    data: {
      id: JOB_ID,
      company_id: COMPANY_ID,
      state: opts.state ?? "completed",
      result_storage_path: "company/job/image.jpg",
      target_publish_date: opts.publishDate,
      generation_params: { aspectRatio: "1x1" },
      post_text: null,
      target_platforms: [],
    },
    error: null,
  };
  getState("social_media_assets").insertResponse = { data: { id: ASSET_ID }, error: null };
  getState("social_post_drafts").insertResponse = { data: { id: DRAFT_ID }, error: null };
  getState("social_connections").selectResponse = { data: [], error: null };
  getState("platform_companies").selectResponse = { data: { timezone: "UTC" }, error: null };
  getState("platform_users").selectResponse = { data: { email: "approver@example.com" }, error: null };
  getState("social_approval_requests").insertResponse = { data: { id: REQUEST_ID }, error: null };
}

beforeEach(() => {
  resetTableState();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Imports — after all vi.mock() calls.
// ---------------------------------------------------------------------------
import { autoAttachImage } from "@/lib/image/auto-attach";
import { onGatePass, onGateReject } from "@/lib/platform/workflow/image-gate";

// ---------------------------------------------------------------------------
// 1. autoAttachImage — gate disabled → draft state='scheduled', no approval request
// ---------------------------------------------------------------------------

describe("autoAttachImage — gate disabled", () => {
  it("creates draft with state='scheduled' and no approval request when gate is disabled", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
      options: { gateEnabled: false },
    });

    expect(result.state).toBe("attached");
    expect(result.pendingReview).toBeUndefined();
    expect(result.approvalRequestId).toBeUndefined();

    const draftInsert = getState("social_post_drafts").inserts[0];
    expect(draftInsert).toBeDefined();
    expect((draftInsert as { state: string }).state).toBe("scheduled");
    expect((draftInsert as { workflow_state?: unknown }).workflow_state).toBeUndefined();

    // No approval request created.
    expect(getState("social_approval_requests").inserts).toHaveLength(0);
  });

  it("behaves identically when options is omitted (backwards-compatible default)", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    expect(result.pendingReview).toBeUndefined();
    const draftInsert = getState("social_post_drafts").inserts[0];
    expect((draftInsert as { state: string }).state).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// 2. autoAttachImage — gate enabled → draft state='draft', approval request created
// ---------------------------------------------------------------------------

describe("autoAttachImage — gate enabled", () => {
  it("creates draft with state='draft' and workflow_state='pending_image_review' when gate is enabled", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
      options: { gateEnabled: true, gate: GATE_CONFIG, batchId: BATCH_ID },
    });

    expect(result.state).toBe("attached");
    expect(result.pendingReview).toBe(true);
    expect(result.draftId).toBe(DRAFT_ID);
    expect(result.assetId).toBe(ASSET_ID);

    const draftInsert = getState("social_post_drafts").inserts[0];
    expect(draftInsert).toBeDefined();
    expect((draftInsert as { state: string }).state).toBe("draft");
    expect((draftInsert as { workflow_state: string }).workflow_state).toBe("pending_image_review");
  });

  it("creates an approval request with subject_type='image_batch' when gate is enabled", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
      options: { gateEnabled: true, gate: GATE_CONFIG, batchId: BATCH_ID },
    });

    expect(result.approvalRequestId).toBe(REQUEST_ID);

    const reqInsert = getState("social_approval_requests").inserts[0];
    expect(reqInsert).toBeDefined();
    expect((reqInsert as { subject_type: string }).subject_type).toBe("image_batch");
    expect((reqInsert as { subject_id: string }).subject_id).toBe(BATCH_ID);
    expect((reqInsert as { post_master_id: unknown }).post_master_id).toBeNull();
  });

  it("inserts one recipient per approver with a hashed token", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });

    await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
      options: { gateEnabled: true, gate: GATE_CONFIG, batchId: BATCH_ID },
    });

    const recipientInserts = getState("social_approval_recipients").inserts;
    expect(recipientInserts).toHaveLength(1);
    const rec = recipientInserts[0] as {
      approval_request_id: string;
      email: string;
      token_hash: string;
    };
    expect(rec.approval_request_id).toBe(REQUEST_ID);
    expect(rec.email).toBe("approver@example.com");
    expect(typeof rec.token_hash).toBe("string");
    expect(rec.token_hash.length).toBeGreaterThan(0);
  });

  it("returns state='attached' without approvalRequestId when approval request insert fails (fail-soft)", async () => {
    configureJobLookup({ publishDate: "2026-06-15" });
    getState("social_approval_requests").insertResponse = {
      data: null,
      error: { message: "DB constraint" },
    };

    const result = await autoAttachImage({
      jobId: JOB_ID,
      companyId: COMPANY_ID,
      approvedBy: APPROVER_ID,
      options: { gateEnabled: true, gate: GATE_CONFIG, batchId: BATCH_ID },
    });

    // Draft still created; attach state is 'attached'.
    expect(result.state).toBe("attached");
    expect(result.draftId).toBe(DRAFT_ID);
    // approvalRequestId is absent because the request could not be created.
    expect(result.approvalRequestId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. onGatePass — batch approved, drafts set to ready_to_schedule
// ---------------------------------------------------------------------------

describe("onGatePass", () => {
  it("sets batch approval_status='approved' and drafts workflow_state='ready_to_schedule'", async () => {
    // Jobs with draft ids.
    getState("image_generation_jobs").selectResponse = {
      data: [
        { auto_attached_draft_id: "draft-a" },
        { auto_attached_draft_id: "draft-b" },
      ],
      error: null,
    };
    // Drafts lookup.
    getState("social_post_drafts").selectResponse = {
      data: [
        { id: "draft-a", scheduled_at: "2026-06-15T00:00:00.000Z" },
        { id: "draft-b", scheduled_at: null },
      ],
      error: null,
    };

    await onGatePass({
      approvalRequestId: REQUEST_ID,
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      actorId: APPROVER_ID,
      autoSchedule: true,
    });

    const batchUpdates = getState("image_generation_batches").updates;
    expect(batchUpdates.length).toBeGreaterThan(0);
    const batchApproveUpdate = batchUpdates.find(
      (u) => (u.patch as { approval_status?: string }).approval_status === "approved",
    );
    expect(batchApproveUpdate).toBeDefined();

    const draftUpdates = getState("social_post_drafts").updates;
    expect(draftUpdates.length).toBeGreaterThan(0);
    const readyUpdate = draftUpdates.find(
      (u) => (u.patch as { workflow_state?: string }).workflow_state === "ready_to_schedule",
    );
    expect(readyUpdate).toBeDefined();
  });

  it("does not error when no jobs have auto_attached_draft_id", async () => {
    getState("image_generation_jobs").selectResponse = {
      data: [],
      error: null,
    };

    await expect(
      onGatePass({
        approvalRequestId: REQUEST_ID,
        batchId: BATCH_ID,
        companyId: COMPANY_ID,
        actorId: APPROVER_ID,
        autoSchedule: false,
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. onGateReject — round 0→1: status='none', drafts set to rework_image
// ---------------------------------------------------------------------------

describe("onGateReject — round 0→1", () => {
  it("increments review_round to 1, sets approval_status='none', archives drafts as rework_image", async () => {
    getState("image_generation_batches").selectResponse = {
      data: { review_round: 0 },
      error: null,
    };
    getState("image_generation_jobs").selectResponse = {
      data: [{ auto_attached_draft_id: DRAFT_ID }],
      error: null,
    };

    await onGateReject({
      approvalRequestId: REQUEST_ID,
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      comment: "Please revise the layout.",
      actorId: APPROVER_ID,
    });

    const batchUpdates = getState("image_generation_batches").updates;
    const resetUpdate = batchUpdates.find(
      (u) =>
        (u.patch as { approval_status?: string }).approval_status === "none" &&
        (u.patch as { review_round?: number }).review_round === 1,
    );
    expect(resetUpdate).toBeDefined();

    const draftUpdates = getState("social_post_drafts").updates;
    const reworkUpdate = draftUpdates.find(
      (u) => (u.patch as { workflow_state?: string }).workflow_state === "rework_image",
    );
    expect(reworkUpdate).toBeDefined();
    expect((reworkUpdate!.patch as { archived_at?: string }).archived_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. onGateReject — round 2→3: status='escalated_to_admin'
// ---------------------------------------------------------------------------

describe("onGateReject — round 2→3 (escalation)", () => {
  it("sets approval_status='escalated_to_admin' when new_round >= 3", async () => {
    getState("image_generation_batches").selectResponse = {
      data: { review_round: 2 },
      error: null,
    };

    await onGateReject({
      approvalRequestId: REQUEST_ID,
      batchId: BATCH_ID,
      companyId: COMPANY_ID,
      comment: "Third rejection.",
      actorId: APPROVER_ID,
    });

    const batchUpdates = getState("image_generation_batches").updates;
    const escalateUpdate = batchUpdates.find(
      (u) =>
        (u.patch as { approval_status?: string }).approval_status === "escalated_to_admin" &&
        (u.patch as { review_round?: number }).review_round === 3,
    );
    expect(escalateUpdate).toBeDefined();

    // Drafts should NOT be reset to rework_image on escalation.
    const draftUpdates = getState("social_post_drafts").updates;
    const reworkUpdate = draftUpdates.find(
      (u) => (u.patch as { workflow_state?: string }).workflow_state === "rework_image",
    );
    expect(reworkUpdate).toBeUndefined();
  });
});
