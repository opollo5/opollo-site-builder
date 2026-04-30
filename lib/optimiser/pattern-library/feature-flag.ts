// Feature-flag gate for the Phase 3 pattern library.
//
// Spec §11.2.4 requires the MSA / engagement letter to include an
// explicit consent clause before the pattern library is enabled in
// production. Engineering can ship the code behind a flag in the
// meantime; flipping the flag in production is a Caleb / Matthew
// decision once the legal text is in place.
//
// The flag is binary: when off, the extractor cron is a no-op and the
// proposal generator skips reading priors from opt_pattern_library
// even if rows exist. Per-client `cross_client_learning_consent` is a
// secondary gate inside the extractor — patterns are only built from
// consenting clients regardless of the global flag.

export function isPatternLibraryEnabled(): boolean {
  const v = process.env.OPT_PATTERN_LIBRARY_ENABLED;
  return v === "true" || v === "1";
}
