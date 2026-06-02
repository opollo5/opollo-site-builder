import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Workflow step management — B3 multi-step approval engine.
//
// Steps are company-scoped and ordered. content_proof approval requests
// use these steps; image_batch requests continue using company_workflow_gates
// unchanged.
// ---------------------------------------------------------------------------

export type StepRole = "reviewer" | "mandatory_reviewer" | "gatekeeper" | "approver";

export type WorkflowStepParticipant = {
  id: string;
  step_id: string;
  platform_user_id: string | null;
  external_email: string | null;
  role: StepRole;
  // Resolved for display — populated when platform_user_id is set
  email?: string;
  name?: string | null;
};

export type WorkflowStep = {
  id: string;
  company_id: string;
  step_order: number;
  name: string;
  pass_rule: "any_one" | "all_must";
  blocking: boolean;
  timeout_days: number;
  participants: WorkflowStepParticipant[];
};

// Role behaviour: blocking roles count toward quorum finalization.
export const BLOCKING_ROLES: StepRole[] = [
  "mandatory_reviewer",
  "gatekeeper",
  "approver",
];

export function isBlockingRole(role: StepRole): boolean {
  return BLOCKING_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// getWorkflowSteps — returns ordered steps with participants for a company.
// ---------------------------------------------------------------------------
export async function getWorkflowSteps(
  companyId: string,
): Promise<WorkflowStep[]> {
  const svc = getServiceRoleClient();

  const { data: steps, error: stepsErr } = await svc
    .from("workflow_steps")
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days")
    .eq("company_id", companyId)
    .order("step_order", { ascending: true });

  if (stepsErr || !steps) {
    logger.error("workflow_steps.get.failed", {
      companyId,
      err: stepsErr?.message,
    });
    return [];
  }

  if (steps.length === 0) return [];

  const stepIds = (steps as Array<{ id: string }>).map((s) => s.id);

  const { data: participants } = await svc
    .from("workflow_step_participants")
    .select("id, step_id, platform_user_id, external_email, role")
    .in("step_id", stepIds);

  // Resolve emails for platform users
  const platformUserIds = (participants ?? [])
    .map((p) => (p as WorkflowStepParticipant).platform_user_id)
    .filter(Boolean) as string[];

  let userMap: Record<string, { email: string; name: string | null }> = {};
  if (platformUserIds.length > 0) {
    const { data: users } = await svc
      .from("platform_users")
      .select("id, email, full_name")
      .in("id", platformUserIds);
    userMap = Object.fromEntries(
      (users ?? []).map((u) => [
        u.id as string,
        { email: u.email as string, name: (u.full_name as string | null) ?? null },
      ]),
    );
  }

  const participantsByStep: Record<string, WorkflowStepParticipant[]> = {};
  for (const p of (participants ?? []) as Array<WorkflowStepParticipant>) {
    const pWithEmail: WorkflowStepParticipant = {
      ...p,
      email: p.platform_user_id
        ? (userMap[p.platform_user_id]?.email ?? p.external_email ?? "")
        : (p.external_email ?? ""),
      name: p.platform_user_id
        ? (userMap[p.platform_user_id]?.name ?? null)
        : null,
    };
    (participantsByStep[p.step_id] ??= []).push(pWithEmail);
  }

  return (steps as Array<WorkflowStep>).map((s) => ({
    ...s,
    participants: participantsByStep[s.id] ?? [],
  }));
}

// ---------------------------------------------------------------------------
// getStepById — returns a single step with participants.
// ---------------------------------------------------------------------------
export async function getStepById(
  stepId: string,
): Promise<WorkflowStep | null> {
  const svc = getServiceRoleClient();

  const { data: step } = await svc
    .from("workflow_steps")
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days")
    .eq("id", stepId)
    .maybeSingle();

  if (!step) return null;

  const { data: participants } = await svc
    .from("workflow_step_participants")
    .select("id, step_id, platform_user_id, external_email, role")
    .eq("step_id", stepId);

  return {
    ...(step as WorkflowStep),
    participants: (participants ?? []) as WorkflowStepParticipant[],
  };
}

// ---------------------------------------------------------------------------
// getNextStep / getPriorStep — navigation helpers.
// ---------------------------------------------------------------------------
export async function getNextStep(
  companyId: string,
  currentStepOrder: number,
): Promise<WorkflowStep | null> {
  const svc = getServiceRoleClient();

  const { data: step } = await svc
    .from("workflow_steps")
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days")
    .eq("company_id", companyId)
    .gt("step_order", currentStepOrder)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!step) return null;

  const { data: participants } = await svc
    .from("workflow_step_participants")
    .select("id, step_id, platform_user_id, external_email, role")
    .eq("step_id", (step as { id: string }).id);

  return {
    ...(step as WorkflowStep),
    participants: (participants ?? []) as WorkflowStepParticipant[],
  };
}

export async function getPriorStep(
  companyId: string,
  currentStepOrder: number,
): Promise<WorkflowStep | null> {
  if (currentStepOrder <= 1) return null;

  const svc = getServiceRoleClient();

  const { data: step } = await svc
    .from("workflow_steps")
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days")
    .eq("company_id", companyId)
    .lt("step_order", currentStepOrder)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!step) return null;

  const { data: participants } = await svc
    .from("workflow_step_participants")
    .select("id, step_id, platform_user_id, external_email, role")
    .eq("step_id", (step as { id: string }).id);

  return {
    ...(step as WorkflowStep),
    participants: (participants ?? []) as WorkflowStepParticipant[],
  };
}

// ---------------------------------------------------------------------------
// upsertWorkflowSteps — replaces a company's entire step list atomically.
// Steps not in the new list are deleted; existing steps are updated or
// inserted. Participants are replaced per step.
// ---------------------------------------------------------------------------
export type UpsertStepInput = {
  step_order: number;
  name: string;
  pass_rule: "any_one" | "all_must";
  timeout_days?: number;
  participants: Array<{
    platform_user_id?: string | null;
    external_email?: string | null;
    role: StepRole;
  }>;
};

export async function upsertWorkflowSteps(
  companyId: string,
  steps: UpsertStepInput[],
): Promise<{ ok: boolean; steps: WorkflowStep[] }> {
  const svc = getServiceRoleClient();

  // Delete all existing steps (cascade deletes participants + clears step_id on requests)
  // Note: we cannot hard-delete steps that have active approval requests pointing to them
  // (step_id FK). We check for active requests first.
  const { data: activeRequests } = await svc
    .from("social_approval_requests")
    .select("id")
    .eq("company_id", companyId)
    .not("step_id", "is", null)
    .is("final_approved_at", null)
    .is("final_rejected_at", null)
    .is("revoked_at", null)
    .limit(1);

  if (activeRequests && activeRequests.length > 0) {
    return {
      ok: false,
      steps: [],
    };
  }

  // Safe to replace: delete existing steps
  await svc.from("workflow_steps").delete().eq("company_id", companyId);

  if (steps.length === 0) {
    return { ok: true, steps: [] };
  }

  // Insert new steps
  const { data: insertedSteps, error: insertErr } = await svc
    .from("workflow_steps")
    .insert(
      steps.map((s) => ({
        company_id: companyId,
        step_order: s.step_order,
        name: s.name,
        pass_rule: s.pass_rule,
        timeout_days: s.timeout_days ?? 14,
      })),
    )
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days");

  if (insertErr || !insertedSteps) {
    logger.error("workflow_steps.upsert.insert_failed", {
      companyId,
      err: insertErr?.message,
    });
    return { ok: false, steps: [] };
  }

  // Insert participants
  const participantRows: Array<{
    step_id: string;
    platform_user_id: string | null;
    external_email: string | null;
    role: string;
  }> = [];

  for (let i = 0; i < steps.length; i++) {
    const stepData = steps[i];
    const insertedStep = (insertedSteps as Array<{ id: string; step_order: number }>).find(
      (s) => s.step_order === stepData.step_order,
    );
    if (!insertedStep) continue;

    for (const p of stepData.participants) {
      participantRows.push({
        step_id: insertedStep.id,
        platform_user_id: p.platform_user_id ?? null,
        external_email: p.external_email ?? null,
        role: p.role,
      });
    }
  }

  if (participantRows.length > 0) {
    const { error: pErr } = await svc
      .from("workflow_step_participants")
      .insert(participantRows);
    if (pErr) {
      logger.error("workflow_steps.upsert.participants_failed", {
        companyId,
        err: pErr.message,
      });
      return { ok: false, steps: [] };
    }
  }

  return { ok: true, steps: await getWorkflowSteps(companyId) };
}
