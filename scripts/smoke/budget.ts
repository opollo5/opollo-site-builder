/**
 * scripts/smoke/budget.ts
 *
 * $5 cumulative budget guard for smoke tests that trigger real AI calls.
 * Reads scripts/smoke/output/budget.json to track spend across runs.
 * Throws if the remaining budget would go negative.
 *
 * Usage:
 *   await guardBudget(estimatedCostUsd);
 *   // ... run AI operations ...
 *   await recordSpend(actualCostUsd);
 */

import fs from "node:fs";
import path from "node:path";

const BUDGET_CAP_USD = 5.0;
const BUDGET_FILE = path.join(import.meta.dirname, "output", "budget.json");

interface BudgetState {
  cumulative_usd: number;
  runs: Array<{ timestamp: string; cost_usd: number; description: string }>;
}

function readBudget(): BudgetState {
  try {
    const raw = fs.readFileSync(BUDGET_FILE, "utf-8");
    return JSON.parse(raw) as BudgetState;
  } catch {
    return { cumulative_usd: 0, runs: [] };
  }
}

function writeBudget(state: BudgetState): void {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function getBudgetRemaining(): number {
  const state = readBudget();
  return BUDGET_CAP_USD - state.cumulative_usd;
}

export function guardBudget(estimatedCostUsd: number): void {
  const state = readBudget();
  const remaining = BUDGET_CAP_USD - state.cumulative_usd;

  if (estimatedCostUsd > remaining) {
    throw new Error(
      `Budget guard: estimated cost $${estimatedCostUsd.toFixed(2)} exceeds ` +
        `remaining budget $${remaining.toFixed(2)} ` +
        `(cap $${BUDGET_CAP_USD.toFixed(2)}, spent $${state.cumulative_usd.toFixed(2)}). ` +
        `Delete scripts/smoke/output/budget.json to reset.`,
    );
  }
}

export function recordSpend(costUsd: number, description = "smoke run"): void {
  const state = readBudget();
  state.cumulative_usd = parseFloat((state.cumulative_usd + costUsd).toFixed(4));
  state.runs.push({
    timestamp: new Date().toISOString(),
    cost_usd: costUsd,
    description,
  });
  writeBudget(state);
}

export function resetBudget(): void {
  writeBudget({ cumulative_usd: 0, runs: [] });
}
