export function isErrorReportingEnabled(): boolean {
  const v = process.env.OPOLLO_ERROR_REPORTING_ENABLED;
  return v === "true" || v === "1";
}
