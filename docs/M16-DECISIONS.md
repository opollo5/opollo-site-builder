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
