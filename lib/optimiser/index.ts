// Re-export hub for the optimiser module. Slices add re-exports here as
// they ship their public surface. Keep imports in app/optimiser and
// app/api/optimiser routed through "@/lib/optimiser" rather than deep
// paths so the module's internal layout can change without churn.

export * from "./types";
export { checkOptimiserSchema } from "./health";
