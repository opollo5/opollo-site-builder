# Opollo Site Builder — Working Brief

## What this is
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients.

## How to work
- Work autonomously. Don't ask for permission for normal coding tasks.
- After any change: run lint, typecheck, and build. Fix failures yourself before reporting back.
- When reporting back, give me a one-paragraph summary, not a blow-by-blow.
- After opening a PR, monitor CI until it passes. If CI fails, read the failure, fix it, push again. Repeat until green.
- "Done" means: PR merged (or handed to Steven for merge, where required) and summary posted. Not: PR open, CI running, waiting for input.

## Merging
- Auto-merge your own PRs when ALL of these are true:
  - CI is fully green (all required checks pass)
  - No review requested and no pending review comments
  - The PR was opened by Claude Code (not by Steven)
  - The PR is not write-safety-critical (see below)
- Human merge still required for:
  - Any PR Claude Code escalates to Steven for a decision
  - M3, M4, M7 milestone PRs (concurrency / transactional / circuit breaker code)
  - Any PR Steven explicitly flags for review

## Self-test loop
- Retry ceiling is 10 attempts per PR, not 3. Retry count alone is no longer the escalation trigger — "not converging" is.
- Escalate to Steven only when: (a) you see the same failure twice in a row (the fix isn't landing), or (b) you hit a genuine architectural question requiring his input — spec deviation, security tradeoff, schema decision.
- CI failure logs are auto-posted as PR comments by `.github/workflows/ci.yml` (added in PR #18). Read those comments directly instead of asking Steven to paste logs.

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
