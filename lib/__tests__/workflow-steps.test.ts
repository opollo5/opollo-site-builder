import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  getWorkflowSteps,
  getNextStep,
  getPriorStep,
  upsertWorkflowSteps,
} from "@/lib/platform/workflow/steps";

// ---------------------------------------------------------------------------
// Integration tests for the B3 workflow step service.
// Verifies step CRUD, navigation, and bridge survival.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001760-0000-0000-0000-000000000001";

async function seedCompany() {
  const svc = getServiceRoleClient();
  // Delete first to avoid slug UNIQUE conflict from prior runs, then insert.
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  const { error } = await svc.from("platform_companies").insert(
    { id: COMPANY_ID, name: "Workflow Steps Test Co", slug: `wf-steps-${COMPANY_ID.slice(-8)}` },
  );
  if (error) throw new Error(`seedCompany failed: ${error.message}`);
}

beforeAll(async () => {
  await seedCompany();
  // Clean up any leftover steps from prior runs
  const svc = getServiceRoleClient();
  await svc.from("workflow_steps").delete().eq("company_id", COMPANY_ID);
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("workflow_steps").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
});

// ---------------------------------------------------------------------------
// upsertWorkflowSteps
// ---------------------------------------------------------------------------

describe("upsertWorkflowSteps", () => {
  it("creates steps with participants", async () => {
    const result = await upsertWorkflowSteps(COMPANY_ID, [
      {
        step_order: 1,
        name: "Internal review",
        pass_rule: "any_one",
        timeout_days: 7,
        participants: [
          { external_email: "internal@wf-test.example.com", role: "mandatory_reviewer" },
        ],
      },
      {
        step_order: 2,
        name: "Client sign-off",
        pass_rule: "all_must",
        timeout_days: 14,
        participants: [
          { external_email: "client@wf-test.example.com", role: "approver" },
          { external_email: "client2@wf-test.example.com", role: "reviewer" },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("Internal review");
    expect(result.steps[0].participants).toHaveLength(1);
    expect(result.steps[0].participants[0].role).toBe("mandatory_reviewer");
    expect(result.steps[1].participants).toHaveLength(2);
  });

  it("replaces steps on re-upsert", async () => {
    await upsertWorkflowSteps(COMPANY_ID, [
      {
        step_order: 1,
        name: "Only step",
        pass_rule: "any_one",
        participants: [],
      },
    ]);

    const steps = await getWorkflowSteps(COMPANY_ID);
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe("Only step");
  });

  it("clears all steps when given empty array", async () => {
    await upsertWorkflowSteps(COMPANY_ID, []);
    const steps = await getWorkflowSteps(COMPANY_ID);
    expect(steps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------

describe("getNextStep / getPriorStep", () => {
  beforeAll(async () => {
    await upsertWorkflowSteps(COMPANY_ID, [
      { step_order: 1, name: "Step 1", pass_rule: "any_one", participants: [] },
      { step_order: 2, name: "Step 2", pass_rule: "all_must", participants: [] },
      { step_order: 3, name: "Step 3", pass_rule: "any_one", participants: [] },
    ]);
  });

  it("getNextStep returns step 2 when current is step 1", async () => {
    const next = await getNextStep(COMPANY_ID, 1);
    expect(next?.name).toBe("Step 2");
    expect(next?.step_order).toBe(2);
  });

  it("getNextStep returns null when at final step", async () => {
    const next = await getNextStep(COMPANY_ID, 3);
    expect(next).toBeNull();
  });

  it("getPriorStep returns step 2 when current is step 3", async () => {
    const prior = await getPriorStep(COMPANY_ID, 3);
    expect(prior?.name).toBe("Step 2");
    expect(prior?.step_order).toBe(2);
  });

  it("getPriorStep returns null when at step 1", async () => {
    const prior = await getPriorStep(COMPANY_ID, 1);
    expect(prior).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate→step bridge survival test
// Verifies that company_workflow_gates data is untouched after migration.
// ---------------------------------------------------------------------------

describe("gate→step bridge: company_workflow_gates untouched", () => {
  it("company_workflow_gates table still exists and is readable", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("company_workflow_gates")
      .select("id, company_id, gate_type, enabled, pass_rule")
      .limit(5);

    expect(error).toBeNull();
    // Table is readable (may be empty in test env — just verify no error)
    expect(Array.isArray(data)).toBe(true);
  });

  it("social_approval_recipients.is_blocking defaults to true for existing rows", async () => {
    const svc = getServiceRoleClient();

    // Insert a test recipient and verify is_blocking defaults to true
    const APPROVAL_REQ_ID = "00001760-0000-0000-0000-000000000002";

    // Seed minimal company + post + approval request
    await svc.from("social_post_master").upsert(
      { id: APPROVAL_REQ_ID, company_id: COMPANY_ID, master_text: "bridge test", state: "pending_client_approval" },
      { onConflict: "id" },
    );

    await svc.from("social_approval_requests").upsert(
      {
        id: APPROVAL_REQ_ID,
        company_id: COMPANY_ID,
        post_master_id: APPROVAL_REQ_ID,
        approval_rule: "any_one",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        snapshot_payload: {},
      },
      { onConflict: "id" },
    );

    const { data: recipient, error: recErr } = await svc
      .from("social_approval_recipients")
      .insert({
        approval_request_id: APPROVAL_REQ_ID,
        email: "bridge-test@wf-test.example.com",
        token_hash: "a".repeat(64),
        // is_blocking intentionally omitted — should default to true
      })
      .select("is_blocking")
      .single();

    expect(recErr).toBeNull();
    expect((recipient as { is_blocking: boolean })?.is_blocking).toBe(true);

    // Cleanup
    await svc.from("social_approval_recipients").delete()
      .eq("approval_request_id", APPROVAL_REQ_ID);
    await svc.from("social_approval_requests").delete().eq("id", APPROVAL_REQ_ID);
    await svc.from("social_post_master").delete().eq("id", APPROVAL_REQ_ID);
  });
});
