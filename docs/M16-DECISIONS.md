# M16 — Autonomous Build Decisions Log

This file is maintained by Claude Code during the autonomous M16 build.
Every significant decision is logged here so Steven can audit the build
without needing to be involved in real-time.

Format:
[SLICE] [TIMESTAMP] Decision: <what> | Reason: <why> | Alternative: <what was rejected>
[SLICE] [TIMESTAMP] [BLOCKED] <what is blocked and why> | Resuming: <next unblocked step>

---

## Decisions

[M16-1] [2026-05-04] Decision: Migration number 0082 | Reason: Last existing migration is 0081_cap_weekly_enabled.sql; next sequential number is 0082 | Alternative: Checked all files under supabase/migrations/, no gaps that needed filling in the M16 range

[M16-1] [2026-05-04] Decision: Kept the naive UNIQUE constraint + DROP pattern from the starter migration for route_registry | Reason: The starter file creates CONSTRAINT route_registry_site_slug_unique, then creates the partial unique index, then drops the naive constraint. This is a valid pattern — the partial index is the actual enforcement. Rewriting would diverge from the verbatim starter. | Alternative: Not creating the naive constraint at all; rejected to stay verbatim with the provided starter file

[M16-1] [2026-05-04] Decision: Did not add site_blueprints/route_registry/shared_content to _setup.ts truncateAll | Reason: All three tables have ON DELETE CASCADE from sites; truncating sites CASCADE in beforeEach already cleans them. Adding to truncateAll would be redundant and could cause ordering issues. | Alternative: Explicit truncation of each table; rejected as unnecessary given CASCADE setup

[M16-SETUP] [2026-05-04] Decision: All six starter files (models.ts, page-document.ts, generator-payload.ts, page-validator.ts, prompts.ts, component-registry.ts) plus opollo-components.css were already present at their correct paths when build started. No copying needed. | Reason: Files were pre-staged before this build session. | Alternative: N/A


[M16-7] [2026-05-04] Decision: processPageM16 marks brief_page as 'generating' before calling runPageDocumentGenerator | Reason: Prevents a second worker from picking up the same page if the brief runner is slow. The generating state is visible on restart. | Alternative: Marking after the Anthropic call (rejected — leaves a window where two workers could start on the same page)

[M16-7] [2026-05-04] Decision: runRenderWorker called synchronously inside processPageM16 (not via cron) | Reason: Operator expects to see rendered HTML in the review surface immediately after page generation. Waiting for the 5-min cron cycle would feel broken. | Alternative: Fire-and-forget via cron only (rejected — bad UX); both paths run (sync in brief-runner, cron as flush safety net)

[M16-7] [2026-05-04] Decision: Blueprint review page is a Client Component (not Server Component with fetches) | Reason: The approve/revert actions and loading state need client-side reactivity. The data load happens client-side via fetch since the route guards use the standard admin-api-gate cookie pattern. | Alternative: Server Component + Server Action (deferred — adds complexity for a low-traffic admin page)

[M16-7] [2026-05-04] Decision: No "section prop editor" or "preview" page in M16-7 | Reason: These were listed in docs/plans/m16-parent.md as M16-7 targets but the CHECKPOINT note says Steven reviews rendered output before M16-8. The rendered HTML is visible via the existing pages UI (/admin/sites/[id]/pages). Adding a dedicated prop editor before confirming the pipeline produces correct output would be premature. Deferring to M16-8+. | Alternative: Building full section prop editor now (rejected — CHECKPOINT is already after M16-7; Steven's review of the pipeline output drives what the editor needs to expose)

---

## Blocked steps

<!-- Claude Code appends blocked items here -->
<!-- When a blocked item is unresolved, continue to the next unblocked slice -->

---

## Checkpoint after M16-7

After M16-7 merges, the build pauses here.
Steven reviews:
1. Site Plan Review screen (does the UX make sense?)
2. Section prop editor (can fields be edited correctly?)
3. Preview (does rendered HTML look right?)
4. Validation (are broken refs correctly flagged?)

After review, Steven approves to continue to M16-8 (WordPress publisher).

---

## Resume protocol

If the build is interrupted:
1. Read this file to understand the current state
2. Check BACKLOG.md M16 tracker for slice statuses
3. Resume from the first slice marked 'in-flight' or 'planned'
4. Do not re-run already-merged slices
