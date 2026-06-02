// ---------------------------------------------------------------------------
// Workflow gate types — Phase 1 Step 2
//
// company_workflow_gates + company_workflow_gate_approvers schema (migration 0172).
// ---------------------------------------------------------------------------

export type GateType = "copy_review" | "image_review" | "final_signoff";
export type PassRule = "all_must" | "any_one";
export type ApprovalStatus =
  | "none"
  | "pending_review"
  | "approved"
  | "rejected"
  | "escalated_to_admin";

export interface WorkflowGate {
  id: string;
  companyId: string;
  gateType: GateType;
  enabled: boolean;
  passRule: PassRule;
  timeoutDays: number;
  autoSchedule: boolean;
}

export interface WorkflowGateApprover {
  id: string;
  gateId: string;
  platformUserId: string | null;
  externalEmail: string | null;
}

export interface WorkflowGateWithApprovers extends WorkflowGate {
  approvers: WorkflowGateApprover[];
}
