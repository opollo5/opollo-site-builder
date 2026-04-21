# Opollo Site Builder — Working Brief

## What this is
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients.

## How to work
- Work autonomously. Don't ask for permission for normal coding tasks.
- After any change: run lint, typecheck, and build. Fix failures yourself before reporting back.
- When reporting back, give me a one-paragraph summary, not a blow-by-blow.
- After opening a PR, monitor CI until it passes. If CI fails, read the failure, fix it, push again. Repeat until green.
- "Done" means: PR open, CI green, summary posted. Not: PR open, CI running, waiting for input.

## Self-test loop
- Retry ceiling is 10 attempts per PR, not 3. Retry count alone is no longer the escalation trigger — "not converging" is.
- Escalate to Steven only when: (a) you see the same failure twice in a row (the fix isn't landing), or (b) you hit a genuine architectural question requiring his input — spec deviation, security tradeoff, schema decision.
- CI failure logs are auto-posted as PR comments by `.github/workflows/ci.yml` (added in PR #18). Read those comments directly instead of asking Steven to paste logs.

## Sub-slice autonomy
For sub-slices of a parent milestone whose plan Steven has already approved (M2a/b/c/d under M2, etc.), execute end-to-end without per-slice plan review:

- Propose the sub-slice plan in the PR description itself, not as a message to Steven beforehand.
- Write code immediately against the approved parent plan.
- Open the PR with plan-as-description + code + tests in one go.
- Self-correct CI failures within the 10-retry ceiling above.
- Auto-merge when green.
- Status update to Steven once merged: one-liner, e.g. "M2c-2 merged, proceeding to M2c-3."

Escalate only for: architectural decisions not in the parent plan, spec deviations, security tradeoffs, or same-failure-twice CI loops. Do NOT escalate for: sub-slice planning, operational/infra issues, routine tradeoffs already covered in the parent plan.

## Auto-continue between sub-slices
After an auto-merged sub-slice PR, automatically proceed to the next sub-slice in the same approved parent milestone without waiting for a prompt. Rule chain:

- `M2c-1 merged → start M2c-2`
- `M2c-2 merged → start M2c-3`
- `M2c-3 merged → start M2d-1` (next slice of parent M2)
- `M2d-N merged → either start M2d-(N+1) or, if M2d was the last slice, status update "M2 complete, ready for Steven's sign-off before M3" and stop`

Stop and wait for Steven only when:
- A parent milestone fully completes (M2 done → wait, do NOT start M3 on your own).
- An architectural escalation surfaces.
- The same CI failure lands twice in a row.

Also: post a one-line status ping per merge so Steven has visibility without needing to prompt — e.g. "M2c-2 merged, starting M2c-3."

## Enabling auto-merge on every PR
Every PR must have GitHub auto-merge armed at creation time. Call `mcp__github__enable_pr_auto_merge` (with `mergeMethod: "SQUASH"`) immediately after `create_pull_request` — it is not enabled implicitly. Without that call, the PR sits in the mergeable state until someone clicks the button in the UI, breaking the self-driving loop.

## Self-audit is the review; proceed without external gate
Self-audit is the first AND the final layer for planning. Once a plan has a populated **"Risks identified and mitigated"** section (see below for what that must contain), proceed directly to implementation. Do NOT post plans to Steven or Claude.ai as a review gate — not for parent milestones, not for sub-slices.

Where plans live:
- Parent milestone plans go in the first sub-slice's PR description.
- Sub-slice plans go in their own PR description.
- Status updates ("M3-1 merged, starting M3-2") happen once per merge — that's the visibility channel.

Escalate to Steven only when:
- You cannot self-resolve a tradeoff (cost, deadline, spec ambiguity).
- A decision needs information you don't have (legal, security review, infrastructure cost ceiling).
- The same CI failure lands twice in a row.

Every plan MUST include a **"Risks identified and mitigated"** section listing:

- Each write-safety hotspot in the proposed design (billed external calls, concurrent writers, multi-row state transitions, triggers, race windows, schema-level uniqueness assumptions).
- How the plan mitigates it (idempotency key, DB unique constraint, advisory lock, dedicated test case, etc.).
- Any gaps you are deliberately deferring, with a reason and a follow-up slice / milestone pointer.

If an obvious write-safety gap exists (missing idempotency key on a billed external call, missing constraint on a high-churn table, missing test assertion on a concurrency invariant, trigger that can deadlock with a worker), fix it in the plan *before* coding. Write-safety-critical milestones (M3 batch generator, anything that spends money or mutates client WP sites) get this audit applied to every sub-slice plan, not just the parent milestone plan.

A plan without a populated "Risks identified and mitigated" section is not ready to execute.

## Commands
- `npm run dev` — local dev
- `npm run lint` — ESLint
- `npm run typecheck` — tsc --noEmit
- `npm run build` — production build
- `npm run test` — Vitest

## Standards
- Server Components by default; Client Components only when required
- shadcn/ui components over custom; Tailwind utility classes only
- Strict TypeScript — no `any`, no `@ts-ignore`
- One logical change per commit; conventional commit messages

## Git workflow
- Branch per task: `feat/`, `fix/`, `chore/`, `refactor/`
- Always open a PR, never push direct to main
- PR description should reference the issue it closes

## What I care about
- Don't loop me in on routine errors — fix and retry
- Do loop me in on design decisions or scope questions
- Keep PRs small enough to review in 5 minutes

## Backlog — UX debt

Operator-facing jargon that leaks DB column names or internal implementation
detail. Pick up on a cleanup slice that naturally lives in M6 (Per-Page
Iteration UI, where admin UX polish fits), or earlier if a sibling slice
happens to be in the same file.

### High — remove scope_prefix from the Add Site form
**Surface:** `components/AddSiteModal.tsx` line ~211 "Scope prefix" field.
**Problem:** A solo-dev operator adding a client site shouldn't have to
understand CSS-scoping strategy. The field leaks `sites.prefix` into the UX.
**Fix:** auto-generate server-side at site creation. Algorithm:
1. Lower-case, ASCII-slugify the site name; keep only `[a-z0-9]`.
2. Take the first 2–4 characters.
3. If that prefix already exists in `sites.prefix`, append a single digit
   (2, 3, …) until unique, capped at length 4.
4. If still colliding past `<prefix>9`, fall back to `<prefix>` + base-36
   counter.

Hide the field from the form entirely. `lib/sites.createSite` accepts
`prefix` today; flip it to optional + server-compute when absent.

### Medium — jargon in design-system authoring forms
Audited 2026-04; current offenders:

- `components/TemplateFormModal.tsx`:
  - "Composition (JSON array)" → "Template composition"
  - "required_fields (JSON)" → "Required fields per component"
  - "seo_defaults JSON (optional)" → "SEO defaults (optional)"
- `components/ComponentFormModal.tsx`:
  - "content_schema (JSON)" → "Content shape (JSON Schema)"
  - "image_slots JSON (optional)" → "Image slots (optional)"
- `components/CreateDesignSystemModal.tsx`:
  - "tokens.css" / "base-styles.css" — keep the filenames (designers write
    CSS; the names are accurate), but add a one-line sub-label explaining
    what each section controls.

Design-system authoring is a developer surface, so full de-jargoning isn't
the goal — just hide the raw column names. JSON editing UX itself
(`<Textarea>` with JSON.parse in onBlur) can survive.

### Low — admin-surface labels that expose IDs
Scan done 2026-04, none found on the primary surfaces:

- `app/admin/batches` / `[id]` — shows "WP id" as a column, which is
  operator-meaningful (they can click through to WP admin); keep.
- `/admin/users` — email + role + status, clean.
- `/admin/sites` — name + URL + status, clean.

No `design_system_id`, `version_lock`, `wp_page_id`, `created_by_uuid`
leaked into labels. Revisit if future surfaces add them.
