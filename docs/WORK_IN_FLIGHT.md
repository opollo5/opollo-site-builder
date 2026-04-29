# Work in flight

Active Claude Code session claims live below. Each session appends a claim block before editing code; both sessions read this file before starting any new slice.

Empty claim-block list means: no parallel work active; serial-single-session is the default. See `docs/PARALLELISM_PLAN.md` for the full protocol, bootstrap prompt, and conflict-recovery procedure.

<!-- CLAIM BLOCKS BELOW THIS LINE — append on slice start, remove on slice merge -->

---
## Session B
- Started: 2026-04-30
- Branch: feat/optimiser-phase-2 (and slice sub-branches)
- Slice: Optimiser Phase 2 — A/B variants (Slice 18), winner detection (Slice 19), behaviour-driven triggers + Phase 2 playbooks (Slice 20), assisted approval (Slice 21)
- Files claimed (only files unique to this work; existing Phase 1.5 / Phase 1 surfaces stay untouched):
  - supabase/migrations/0057_optimiser_ab_variants_tests.sql (new)
  - supabase/migrations/0058_optimiser_phase_2_playbooks.sql (new)
  - supabase/migrations/0059_optimiser_assisted_approval.sql (new)
  - supabase/rollbacks/0057_*.down.sql, 0058_*.down.sql, 0059_*.down.sql
  - lib/optimiser/variants/* (new folder — Slice 18)
  - lib/optimiser/ab-testing/* (new folder — Slice 19 monitor + Bayesian)
  - lib/optimiser/behaviour-triggers.ts (new — Slice 20)
  - lib/optimiser/assisted-approval.ts (new — Slice 21)
  - app/api/optimiser/proposals/[id]/create-variant/route.ts (new — Slice 18)
  - app/api/cron/optimiser-ab-monitor/route.ts (new — Slice 19)
  - skills/optimiser/variant-generation/SKILL.md (new)
  - skills/optimiser/winner-detection/SKILL.md (new)
  - skills/optimiser/{trust-gap,intent-mismatch,stale-social-proof}/SKILL.md (new — Slice 20)
  - vercel.json (additive — appends one cron entry only)
  - components/optimiser/ProposalReview.tsx (Slice 18 — adds "Create A/B variant" affordance after approve)
  - app/optimiser/clients/[id]/settings/page.tsx (Slice 21 — assisted-approval toggle)
  - components/optimiser/PageBrowser.tsx, PageDetail.tsx (Slice 19 — A/B test status banner)
- Migration numbers reserved: 0057, 0058, 0059
- Expected completion: same session; auto-merge each slice on green CI per the user's Phase 2 brief
- Notes: WORK_IN_FLIGHT had a stale Session A claim from 2026-04-24 (M12-6 work shipped long ago — the claim block is left in place per "removal protocol" since the Session A owner removes their own claim).
---

## ~~Session A~~ (stale claim from 2026-04-24, M12-6 shipped — left in place; A's owner removes when they next push)
- Started: 2026-04-24
- Branch: feat/m12-6-save-draft-persistence
- Slice: M12-6 — Save-Draft persistence for briefs review; PATCH endpoint + button + re-enable fixme'd E2E test
- Files claimed:
  - app/api/briefs/[brief_id]/pages/route.ts (new PATCH handler)
  - components/BriefReviewClient.tsx (add "Save draft" button + endpoint call)
  - e2e/briefs-review.spec.ts (re-enable fixme'd upload→parse→commit test)
  - lib/briefs.ts (if persistence logic needed)
- Migration number reserved: none (data-only, no schema changes)
- Expected completion: same session; auto-merge on green CI
- Notes: M12-1 shipped with version_lock on brief_pages; M12-6 enables saving edits before commit to prevent 409 hash mismatch. The commit flow currently 409s because client computes hash from in-memory edits while server recomputes from unedited DB rows.
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
- 0017 — M12-2 brand_voice + design_direction columns on briefs. Executing on `feat/m12-2-brand-voice-site-conventions`.
- ~~0019 — M13-1 posts schema.~~ Shipped in #142.
- ~~0021 — M13-3 briefs.content_type column.~~ Shipped in #145.

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
