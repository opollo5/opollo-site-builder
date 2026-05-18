# Framework Workstream — Build Brief

**Scope:** Collapse the 80 cluster IDs from the 82-route audit into 16 named templates. Migrate every route to its target template. Make the audit's R-divergences impossible going forward via lint rules and audit:static enforcement.

This is a **separate workstream** from the composer rebuild. It does not block the composer. The composer and the framework eventually meet — the composer lives inside T-DETAIL-TABBED.

Read in this order:

1. `../DECISIONS_LOCKED.md` — all D-decisions locked
2. `PASS_1_FRAMEWORK.docx` — original framework proposal (now with D-decisions locked)
3. `TEMPLATES.md` — every template's spec in one document
4. `WAVE_PLAN.md` — build order across four waves with per-template route lists

## Working principle

You're building a template *framework*, not just templates. Every template is:
- A React component at `templates/T-<NAME>.tsx` exporting a typed component
- A documented spec in `TEMPLATES.md`
- A lint/audit rule that ensures routes assigned to that template conform

Migrating a route means replacing its current ad-hoc composition with `<T-LIST-STANDARD title="Sites" actions={...}>{content}</T-LIST-STANDARD>` (or equivalent). The audit:static script verifies the migration is correct.

## Four waves

| Wave | Focus | Templates | Routes affected |
|---|---|---|---|
| 1 — Unblock social + critical detail | Most painful current state | T-DETAIL-TABBED, T-LIST-STANDARD, T-DASHBOARD-FEED, T-DASHBOARD-KPI | ~30 routes including all /company/social/* |
| 2 — Cover admin bulk | Largest volume | T-DETAIL-SUMMARY, T-FORM, T-LIST-WIDE, T-SETTINGS-FLAT | ~35 routes mostly /admin/* |
| 3 — Specialised | Editor and wizard surfaces | T-DETAIL-EDITOR, T-WIZARD-STEP, T-REVIEW-LINK, T-GRID | ~11 routes |
| 4 — Edge | Public + redirects | T-AUTH-CHROME, T-FULL-BLEED-EDITOR, T-ERROR-STATE, T-REDIRECT-STUB | ~16 routes |

See `WAVE_PLAN.md` for per-template route lists.

## Cross-wave precondition (do this first)

Before Wave 1 starts, commission the four new primitives listed in `composer/COMPONENT_MAP.md` §"New primitives":

- `components/ui/callout.tsx` (D-10)
- `components/ui/section-header.tsx` (D-7)
- `components/ui/pagination.tsx` (D-8)
- `components/ui/empty-state.tsx` (conform existing or create — D-9)

These primitives are shared by composer PR C and framework Wave 1. Build them once.

## Verification gate (per wave)

After every wave:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm audit:static --templates-only      # enforces the framework rules
```

`audit:static --templates-only` re-runs the 82-route audit and verifies every route now matches its assigned template's signature.

## What "done" looks like

Framework workstream is complete when:

1. All 16 templates have a corresponding component in `templates/`.
2. Every audit route is migrated to its target template (per `WAVE_PLAN.md`).
3. All 30 R-divergences listed in `TEMPLATES.md` §"Resolved divergences" are no longer present.
4. `audit:static` passes with zero violations.
5. CI enforces `audit:static` on every PR going forward.

Pace yourself. Four waves × ~2 weeks each = ~8 weeks of focused work. Don't rush; the audit is the proof.
