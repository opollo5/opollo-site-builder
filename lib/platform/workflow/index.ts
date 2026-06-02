import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type {
  GateType,
  PassRule,
  WorkflowGateApprover,
  WorkflowGateWithApprovers,
} from "./types";

export type { ApprovalStatus, GateType, PassRule, WorkflowGate, WorkflowGateApprover, WorkflowGateWithApprovers } from "./types";

// ---------------------------------------------------------------------------
// Input type for upserting gates.
// ---------------------------------------------------------------------------

export interface UpsertGateInput {
  gateType: GateType;
  enabled: boolean;
  passRule: PassRule;
  timeoutDays: number;
  autoSchedule: boolean;
  approvers: Array<{ platformUserId?: string; externalEmail?: string }>;
}

// ---------------------------------------------------------------------------
// DB row shapes (from migration 0172). We don't rely on generated types
// so the code compiles before supabase types are regenerated.
// ---------------------------------------------------------------------------

interface GateRow {
  id: string;
  company_id: string;
  gate_type: string;
  enabled: boolean;
  pass_rule: string;
  timeout_days: number;
  auto_schedule: boolean;
  created_at: string;
  updated_at: string;
}

interface ApproverRow {
  id: string;
  gate_id: string;
  platform_user_id: string | null;
  external_email: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Defaults — three disabled gates returned when a company has no config yet.
// ---------------------------------------------------------------------------

const ALL_GATE_TYPES: GateType[] = ["copy_review", "image_review", "final_signoff"];

function defaultGates(companyId: string): WorkflowGateWithApprovers[] {
  return ALL_GATE_TYPES.map((gateType) => ({
    id: "",
    companyId,
    gateType,
    enabled: false,
    passRule: "any_one" as PassRule,
    timeoutDays: 14,
    autoSchedule: true,
    approvers: [],
  }));
}

// ---------------------------------------------------------------------------
// Map DB rows → domain types.
// ---------------------------------------------------------------------------

function mapGateRow(row: GateRow, approvers: ApproverRow[]): WorkflowGateWithApprovers {
  return {
    id: row.id,
    companyId: row.company_id,
    gateType: row.gate_type as GateType,
    enabled: row.enabled,
    passRule: row.pass_rule as PassRule,
    timeoutDays: row.timeout_days,
    autoSchedule: row.auto_schedule,
    approvers: approvers.map(
      (a): WorkflowGateApprover => ({
        id: a.id,
        gateId: a.gate_id,
        platformUserId: a.platform_user_id,
        externalEmail: a.external_email,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// getGates — returns all three gate configs for a company. If no DB rows
// exist yet, returns three disabled defaults so callers always see all gates.
// ---------------------------------------------------------------------------

export async function getGates(companyId: string): Promise<WorkflowGateWithApprovers[]> {
  const svc = getServiceRoleClient();

  const { data: gateRows, error: gateErr } = await svc
    .from("company_workflow_gates")
    .select("id, company_id, gate_type, enabled, pass_rule, timeout_days, auto_schedule, created_at, updated_at")
    .eq("company_id", companyId)
    .order("gate_type", { ascending: true });

  if (gateErr) {
    logger.error("workflow.gates.get.failed", { company_id: companyId, err: gateErr.message });
    // Return defaults on error so the caller always gets a usable structure.
    return defaultGates(companyId);
  }

  if (!gateRows || gateRows.length === 0) {
    return defaultGates(companyId);
  }

  const gateIds = (gateRows as GateRow[]).map((r) => r.id);

  const { data: approverRows, error: approverErr } = await svc
    .from("company_workflow_gate_approvers")
    .select("id, gate_id, platform_user_id, external_email, created_at")
    .in("gate_id", gateIds);

  if (approverErr) {
    logger.error("workflow.gates.approvers.get.failed", {
      company_id: companyId,
      err: approverErr.message,
    });
    // Return gates without approvers rather than failing entirely.
    return (gateRows as GateRow[]).map((r) => mapGateRow(r, []));
  }

  const approversByGate = new Map<string, ApproverRow[]>();
  for (const a of (approverRows ?? []) as ApproverRow[]) {
    const list = approversByGate.get(a.gate_id) ?? [];
    list.push(a);
    approversByGate.set(a.gate_id, list);
  }

  const result: WorkflowGateWithApprovers[] = (gateRows as GateRow[]).map((r) =>
    mapGateRow(r, approversByGate.get(r.id) ?? []),
  );

  // Fill in any missing gate types with disabled defaults.
  const existingTypes = new Set(result.map((g) => g.gateType));
  for (const gateType of ALL_GATE_TYPES) {
    if (!existingTypes.has(gateType)) {
      result.push({
        id: "",
        companyId,
        gateType,
        enabled: false,
        passRule: "any_one",
        timeoutDays: 14,
        autoSchedule: true,
        approvers: [],
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// getEnabledGate — returns a single gate by type if it exists and is enabled,
// or null if absent or disabled.
// ---------------------------------------------------------------------------

export async function getEnabledGate(
  companyId: string,
  type: GateType,
): Promise<WorkflowGateWithApprovers | null> {
  const svc = getServiceRoleClient();

  const { data: gateRow, error: gateErr } = await svc
    .from("company_workflow_gates")
    .select("id, company_id, gate_type, enabled, pass_rule, timeout_days, auto_schedule, created_at, updated_at")
    .eq("company_id", companyId)
    .eq("gate_type", type)
    .eq("enabled", true)
    .maybeSingle();

  if (gateErr) {
    logger.error("workflow.gate.get_enabled.failed", {
      company_id: companyId,
      gate_type: type,
      err: gateErr.message,
    });
    return null;
  }

  if (!gateRow) return null;

  const row = gateRow as GateRow;

  const { data: approverRows, error: approverErr } = await svc
    .from("company_workflow_gate_approvers")
    .select("id, gate_id, platform_user_id, external_email, created_at")
    .eq("gate_id", row.id);

  if (approverErr) {
    logger.error("workflow.gate.approvers.get_enabled.failed", {
      gate_id: row.id,
      err: approverErr.message,
    });
    return mapGateRow(row, []);
  }

  return mapGateRow(row, (approverRows ?? []) as ApproverRow[]);
}

// ---------------------------------------------------------------------------
// upsertGates — write (or overwrite) all gate configs for a company.
//
// For each gate:
//   1. Upsert the gate row (ON CONFLICT company_id, gate_type DO UPDATE).
//   2. Delete all existing approver rows for that gate.
//   3. Insert the new approver rows.
//
// The caller is responsible for validating no duplicate gate_types in the input.
// ---------------------------------------------------------------------------

export async function upsertGates(
  companyId: string,
  gates: UpsertGateInput[],
  _updatedBy: string,
): Promise<void> {
  // Guard: no duplicate gate_types.
  const typesSeen = new Set<GateType>();
  for (const g of gates) {
    if (typesSeen.has(g.gateType)) {
      throw new Error(`Duplicate gate_type in input: ${g.gateType}`);
    }
    typesSeen.add(g.gateType);
  }

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  for (const gate of gates) {
    // 1. Upsert the gate row.
    const { data: upserted, error: upsertErr } = await svc
      .from("company_workflow_gates")
      .upsert(
        {
          company_id: companyId,
          gate_type: gate.gateType,
          enabled: gate.enabled,
          pass_rule: gate.passRule,
          timeout_days: gate.timeoutDays,
          auto_schedule: gate.autoSchedule,
          updated_at: now,
        },
        { onConflict: "company_id,gate_type" },
      )
      .select("id")
      .single();

    if (upsertErr || !upserted) {
      logger.error("workflow.gates.upsert.gate_failed", {
        company_id: companyId,
        gate_type: gate.gateType,
        err: upsertErr?.message ?? "no row returned",
      });
      throw new Error(`Failed to upsert gate ${gate.gateType}: ${upsertErr?.message ?? "no row returned"}`);
    }

    const gateId = (upserted as { id: string }).id;

    // 2. Delete existing approvers for this gate.
    const { error: deleteErr } = await svc
      .from("company_workflow_gate_approvers")
      .delete()
      .eq("gate_id", gateId);

    if (deleteErr) {
      logger.error("workflow.gates.upsert.approvers_delete_failed", {
        gate_id: gateId,
        err: deleteErr.message,
      });
      throw new Error(`Failed to clear approvers for gate ${gateId}: ${deleteErr.message}`);
    }

    // 3. Insert new approvers (skip if none supplied).
    if (gate.approvers.length > 0) {
      const rows = gate.approvers.map((a) => ({
        gate_id: gateId,
        platform_user_id: a.platformUserId ?? null,
        external_email: a.externalEmail ?? null,
      }));

      const { error: insertErr } = await svc
        .from("company_workflow_gate_approvers")
        .insert(rows);

      if (insertErr) {
        logger.error("workflow.gates.upsert.approvers_insert_failed", {
          gate_id: gateId,
          err: insertErr.message,
        });
        throw new Error(`Failed to insert approvers for gate ${gateId}: ${insertErr.message}`);
      }
    }
  }
}
