# Template — Definition of Done

A template (one of the 16 in `TEMPLATES.md`) is considered done when **every** item on this checklist is true. Apply this checklist to every template-creation PR. Apply it again to every route-migration PR.

This file replaces the previously-implied rules scattered across `TEMPLATES.md`, `ARCHITECTURE_GUARDRAILS.md`, and the audit. Use this as the single source.

---

## A. Component requirements

The template component itself, at `templates/T-<NAME>.tsx`:

- [ ] Exports a single React component matching its name (`T-LIST-STANDARD` → `export function TListStandard`)
- [ ] Component is a server component by default (no `'use client'`) unless interactivity inherently requires client-side
- [ ] Props are typed with a single exported `interface` named `T<Name>Props`
- [ ] No props named `variant` with 5+ values (extract a sibling template instead)
- [ ] No `children` prop where a structured slot (`content`, `feed`, `preview`) better expresses the intent
- [ ] Uses existing `AppShell`, `PageShell`, `PageHeader` primitives — does not re-implement
- [ ] No raw `<button>`, `<table>`, `<input>`, `<select>`, `<textarea>` — uses primitives
- [ ] No `bg-emerald-*`, `text-emerald-*`, `bg-gray-*`, hardcoded colour utilities — uses semantic tokens
- [ ] No `font-medium`, `font-semibold`, `font-bold` outside the typography primitives — uses `text-section-title` etc.
- [ ] No `animate-pulse` outside `<Skeleton>` — uses the primitive
- [ ] No inline `<div className="min-h-[50vh] ... border-dashed">` empty states — uses `<EmptyState>`
- [ ] No inline `<div role="alert">` — uses `<Alert>` or `<Callout>`
- [ ] Width mode declared explicitly via prop or shell-default; no `max-w-*` literals in the template body
- [ ] Modal usage (if any) uses Dialog primitive with `size` prop, not raw `max-w-*`

## B. Documentation requirements

In `framework/TEMPLATES.md` for this template:

- [ ] Owner / audience / mode lines are present
- [ ] Props signature is shown as a TypeScript interface
- [ ] Composition is enumerated in order (PageShell ▸ PageHeader ▸ ...)
- [ ] Width modes supported are listed
- [ ] Routes assigned are listed with the critical-route flag where appropriate
- [ ] Resolved R-divergences are linked (R3, R10, etc.)
- [ ] Migration steps are concrete (1, 2, 3, ...)

## C. Tests

- [ ] Storybook story (or test-component renderer) shows the template with three states: standard data, empty, error
- [ ] Snapshot or visual regression test exists (Playwright `expect(page).toHaveScreenshot()`)
- [ ] If the template supports multiple width modes, each width has a test
- [ ] If the template has slots (`actions`, `filterBar`, `callout`, `footerActions`), at least one test renders with all slots filled

## D. Audit conformance

- [ ] `pnpm audit:static --templates=T-<NAME>` returns zero violations
- [ ] No route currently assigned to this template (per `WAVE_PLAN.md`) still uses a pre-template ad-hoc composition
- [ ] No new route added since the template shipped uses a pattern this template would cover without using this template

## E. Per-route migration (one per assigned route)

When migrating a route TO this template:

- [ ] Route's `page.tsx` imports `T-<NAME>` and renders content through its props/slots
- [ ] Old ad-hoc PageHeader / Alert / div scaffolding is REMOVED, not left commented out
- [ ] Width prop is set explicitly if non-default
- [ ] If the route had `width=none` per audit, it is now `width="standard"` or `width="wide"` per `DECISIONS_LOCKED.md` D-11
- [ ] If the route had a bespoke banner (BlogStyleCalibrationBanner, OnboardingReminderBanner), it now uses `<Callout>` per D-10
- [ ] If the route had a bespoke empty state, it now uses `<EmptyState>` per D-9
- [ ] If the route had an inline pagination implementation, it now uses `<Pagination>` per D-8
- [ ] If the route had a section header as `<h2>` inline, it now uses `<SectionHeader>` per D-7
- [ ] `pnpm audit:static --route=<route-path>` returns zero violations for that route
- [ ] Playwright smoke test for the route still passes (or is added if absent)

## F. Cumulative gate (every PR)

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm audit:static
```

All five must pass before the PR is considered done.

---

## How to use this

When opening a PR that creates a template or migrates routes to one:

1. Copy this file's checklist into the PR description.
2. Tick each box as you go.
3. Do not request review until every box is ticked.
4. If a box can't be ticked, document why in the PR description AND add a `CLAUDE-ASSUMPTION:` comment AND append to `composer/ACCEPTANCE.md` §DECISION_TRAIL.

The checklist is the contract. The audit:static script enforces most of it programmatically; this document is for the parts the audit can't catch (slot naming, prop ergonomics, server/client correctness).
