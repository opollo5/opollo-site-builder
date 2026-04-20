# Opollo Site Builder — Working Brief

## What this is
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients.

## How to work
- Work autonomously. Don't ask for permission for normal coding tasks.
- After any change: run lint, typecheck, and build. Fix failures yourself before reporting back.
- Only stop and ask me if: you hit an architectural decision, a secret/credential issue, or you've tried twice and can't fix a failure.
- When reporting back, give me a one-paragraph summary, not a blow-by-blow.
- After opening a PR, monitor CI until it passes. If CI fails, read the failure, fix it, push again. Repeat until green.
- Only report back when CI is green, or after two failed fix attempts on the same issue, or if you hit an architectural/scope question.
- Your "done" state is: PR open, CI green, summary posted. Not: PR open, CI running, waiting for input.

## Commands
- `npm run dev` — local dev
- `npm run lint` — ESLint
- `npm run typecheck` — tsc --noEmit
- `npm run build` — production build
- `npm run test` — (add when tests exist)

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
