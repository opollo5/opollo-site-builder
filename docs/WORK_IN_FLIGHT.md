# Work in flight

Active Claude Code session claims live below. Each session appends a claim block before editing code; both sessions read this file before starting any new slice.

Empty claim-block list means: no parallel work active; serial-single-session is the default. See `docs/PARALLELISM_PLAN.md` for the full protocol, bootstrap prompt, and conflict-recovery procedure.

<!-- CLAIM BLOCKS BELOW THIS LINE — append on slice start, remove on slice merge -->

---
## Session A
- Started: 2026-05-03
- Branch: feat/p2-4-invitation-callbacks
- Slice: P2-4 — invitation reminder + expiry callbacks via QStash. Day-3 reminder + day-14 expiry transitions, idempotent on duplicate webhook fires.
- Files claimed:
  - lib/qstash.ts (new)
  - lib/platform/invitations/callbacks.ts (new)
  - lib/platform/invitations/index.ts (re-export)
  - app/api/platform/invitations/route.ts (enqueue on send)
  - app/api/platform/invitations/callbacks/reminder/route.ts (new webhook)
  - app/api/platform/invitations/callbacks/expiry/route.ts (new webhook)
  - lib/__tests__/platform-invitation-callbacks.test.ts (new)
  - .env.example, .env.local.example (QStash env vars)
  - package.json + package-lock.json (@upstash/qstash)
  - docs/WORK_IN_FLIGHT.md
- Migration number reserved: none
- Expected completion: same session.
---

## ~~Session A (stale)~~ (stale claim from 2026-04-24, M12-6 shipped — left in place; previous owner removes when they next push)
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
- ~~0070 — P1 Platform Foundation (platform_* + social_* schema + RLS).~~ Shipped in #376 + #377.

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
