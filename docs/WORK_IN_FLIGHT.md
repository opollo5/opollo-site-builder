# Work in flight

Active Claude Code session claims live below. Each session appends a claim block before editing code; both sessions read this file before starting any new slice.

Empty claim-block list means: no parallel work active; serial-single-session is the default. See `docs/PARALLELISM_PLAN.md` for the full protocol, bootstrap prompt, and conflict-recovery procedure.

<!-- CLAIM BLOCKS BELOW THIS LINE — append on slice start, remove on slice merge -->

---
## Session B
- Started: 2026-04-24
- Branch: fix/m15-3-env-audit-actionables
- Slice: M15-3 env audit + three actionable fixes (dual-key runbook honesty, env coupling validation at boot, doc-drift cleanup)
- Files claimed:
  - docs/SCHEMA_AUDIT_2026-04-24.md (M15-2 audit — merged within this PR)
  - docs/ENV_AUDIT_2026-04-24.md (M15-3 audit — merged within this PR)
  - docs/_audit_scratch/ (scratch inputs for M15-2..M15-6; removed before merge or in a follow-up)
  - docs/RUNBOOK.md (master-key rotation section rewrite + LANGFUSE_HOST typo fix)
  - docs/BACKLOG.md (DEFAULT_TENANT_* strike-through + REGEN_RETRY_BACKOFF_MS reclassify)
  - docs/PROMPT_VERSIONING.md (not-yet-shipped banner)
  - .env.local.example (dead DEFAULT_TENANT_* entries commented out)
  - lib/env-validation.ts (new)
  - lib/__tests__/env-validation.test.ts (new)
  - instrumentation.ts (wire validateEnvCouplingOnce into register())
- Migration number reserved: none
- Expected completion: same session; auto-merge on green CI; then proceed to M15-4 audit under pause rules
- Notes: M15-1 is in flight in Session A (`/api/ops/reset-admin-password` fix). Session B stays off that endpoint, the `opollo_users.deleted_at → revoked_at` fix, and any related migration.
---

## Hot-shared files (always check before claiming)

Even with no other session active, assume these files are "hot" and coordinate explicitly if touching them while another session is in flight:

- `CLAUDE.md`
- `docs/BACKLOG.md`
- `docs/WORK_IN_FLIGHT.md` (this file)
- `package.json`
- `package-lock.json`
- `supabase/migrations/*.sql` (migrations grab version numbers — reserve explicitly below)
- `.github/workflows/*.yml`
- `.github/dependabot.yml`
- `middleware.ts`
- `lib/supabase.ts`
- `lib/auth.ts`
- `lib/http.ts`
- `lib/logger.ts`
- `lib/request-context.ts`
- `lib/security-headers.ts`
- `next.config.mjs`

## Reserved migration numbers

When a session starts a migration, reserve the number here before writing the file. Format:

```
- 0010 — Session A — M5-1 component gallery schema (branch: feat/m5-1-component-gallery-schema)
```

- 0013 — M12-1 briefs schema: `briefs`, `brief_pages`, `brief_runs`, `site_conventions` + `site-briefs` Storage bucket. Executing on `feat/m12-1-briefs-schema`.

## Claim block template

Copy-paste under `<!-- CLAIM BLOCKS BELOW THIS LINE -->`:

```
---
## Session <A|B>
- Started: YYYY-MM-DD HH:MM UTC
- Branch: <type>/<scope>
- Slice: <slice name + one-line description>
- Files claimed:
  - <path>
  - <path>
- Migration number reserved: <N, if applicable — also add to the Reserved migration numbers list above>
- Expected completion: <ballpark — hours / same day / next session>
---
```

## Removal protocol

On PR merge:

1. The session's **next** PR removes its claim block in the first commit. No dedicated cleanup PR needed.
2. If the session is done for the day with no follow-up queued, open a one-line cleanup PR removing the block.
3. If a slice is abandoned mid-flight, convert the block to `## Paused — Session <A|B>` with a short note so the other session knows the files are still claimed pending triage.

## Pause / abandonment blocks

If a session pauses mid-slice (user closed the tab, hit context compaction, etc.) and intends to resume later, convert the active claim to:

```
---
## Paused — Session A
- Paused at: YYYY-MM-DD HH:MM UTC
- Branch: <branch> (unmerged; rebase before resuming)
- Slice: <slice>
- Reason: <one line>
- Files still claimed:
  - <path>
  - <path>
- Resume with: <bootstrap prompt snippet or "reopen the branch and continue">
---
```

If abandoned entirely:

1. Delete the branch on GitHub (`git push origin --delete <branch>`).
2. Remove the claim block.
3. Move the abandoned work into `docs/BACKLOG.md` with a pickup trigger if it should be revisited.
