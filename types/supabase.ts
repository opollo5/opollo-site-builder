// types/supabase.ts
//
// PLACEHOLDER — schema types not yet bootstrapped.
//
// Until this file is replaced with the real generated output, the Supabase
// client is typed as `any` (same behaviour as before M15-8).  The CI drift
// gate is inactive while this placeholder is in place — it only activates
// once the file contains the `@generated` marker that `supabase gen types`
// emits on the first line.
//
// Bootstrap (one-time, requires Docker + local stack running):
//
//   supabase start
//   npm run gen:types
//   git add types/supabase.ts
//   git commit -m "chore(infra): bootstrap supabase schema types"
//
// After that commit, every future migration must be followed by
// `npm run gen:types` + `git add types/supabase.ts` or CI will fail.
// See docs/RUNBOOK.md "Supabase schema types bootstrap" for the full
// procedure, and docs/patterns/new-migration.md for the per-migration reminder.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Placeholder: typed as `any` until bootstrap runs.
// Replacing this with the real generated type activates TypeScript column-drift
// checking and the CI gate simultaneously.
export type Database = any; // nolint: will be replaced by real generated types
