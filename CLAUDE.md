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
