# Composer Workstream — Build Brief

**Scope:** Replace the existing social composer at `/company/social/poster` (or wherever its current path is — verify with `git grep -l 'social/poster'`). Build behind `FEATURE_COMPOSER_V2`.

**Mount path (new):** `app/(platform)/social/poster/page.tsx` (parent dashboard) + `app/(platform)/social/poster/composer/page.tsx` (split-pane overlay).

Read in this order:

1. `../DECISIONS_LOCKED.md` — all decisions
2. `SPEC_v1.3.docx` — full product spec (supersedes Spec 22 where they conflict; DECISIONS_LOCKED.md supersedes this spec where they conflict)
3. `SCHEDULING_PROPOSAL.docx` — scheduling state machine + 4 tabs
4. `SCHEMA.md` — database schema delta
5. `API_CONTRACTS.md` — every endpoint with request/response types
6. `COMPONENT_MAP.md` — wireframe class names → React component file paths
7. `BUILD_ORDER.md` — PR sequence with verification gates
8. `ACCEPTANCE.md` — self-verifiable checklist
9. `.env.example` — required env vars

Then start with PR A.

## Scope summary

The composer is an **eight-PR** rebuild. PRs A–H are listed in `BUILD_ORDER.md`. Each PR has:
- Scope (files to create or modify)
- Dependencies (which prior PR must be merged first)
- Verification gate (commands you run before declaring the PR done)

**Do not skip ahead.** PR D depends on PR C; PR F depends on PR B; etc.

## What you are building

- A split-pane composer overlay (left = editor, right = live preview or mini-calendar)
- A dashboard with a 7-column calendar grid + right-side day detail
- Four scheduling modes (Post now / Schedule / Publish regularly / Save as draft)
- Approval workflow as a toggle on every scheduling tab
- Bulk CSV upload modal (canonical CSV format reused by CAP automation)
- Post analytics modal (triggered by clicking a published post)
- Per-platform preview cards (LinkedIn, Facebook, X, Instagram, GBP)
- "Customize for [platforms]" per-platform content variants
- "Connect a Social Profile" empty-state callout when no connections exist

## What you are NOT building

Per Spec 22 exclusions that still hold and per `DECISIONS_LOCKED.md` §5:

- Mobile composer (Phase 2)
- Multi-image carousel (Phase 2)
- A/B variant testing UI (Phase 3)
- CAP automation feed UI (lives in `lib/cap/`, separate workstream)

## Verification before merge

Each PR has a verification gate. The composite gate, before declaring the entire workstream done:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e composer --flag FEATURE_COMPOSER_V2
```

All five must pass. If any fail, the gate is not met and the workstream is not done.

## Visual reference

Open `../wireframes/00-dashboard-empty-state.html` through `11-add-profile-dropdown.html` in a browser. The class names in those HTML files map 1:1 to React component file paths via `COMPONENT_MAP.md`. Do not invent new visual patterns; do not deviate from the wireframes without a documented reason in `DECISION_TRAIL`.
