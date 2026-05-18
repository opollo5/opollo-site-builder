# Feature flags

This file is the authoritative list of feature flags used in the social composer / platform workstream. All flags are environment variables read as strings; check with `=== 'true'`.

## Active flags

| Flag | Default | Gates | Unblocked by |
|---|---|---|---|
| `FEATURE_COMPOSER_ENABLED` | `false` | Full social composer UI (Spec 22) | Week 0 autosave lab passing |
| `FEATURE_AUTOSAVE_ADOPTED` | `false` | `useAutoSave` wired into composer; blocked on lab validation | Lab all-green |
| `FEATURE_AI_ASSISTANT_COMPOSER` | `false` | AI-assisted copy generation inside composer (Spec 22 PR 4) | Phase 2 |
| `FEATURE_TIMELINE_VIEW` | `false` | Visual timeline / calendar view (Spec 22 PR 5) | Phase 2 |
| `FEATURE_PRE_EXPIRY_WARNINGS` | `false` | Pre-expiry connection warning banner + notifications (Spec 23 PR 1) | Migration 0110 + cron |
| `FEATURE_COMPOSER_V2` | `false` | Social composer rebuild (social-01-brief). New split-pane composer + dashboard. Old poster remains. | PR A–H merged + manual smoke |
| `NEXT_PUBLIC_FEATURE_COMPOSER_V2` | `false` | Client-side companion to FEATURE_COMPOSER_V2. Must match. | Same as above |

## Rules

- All flags are plain strings. Never coerce to boolean with `!!process.env.FLAG` — use `process.env.FLAG === 'true'`.
- Server-side flags are read once at cold-start and cached for the request lifetime.
- Client-side flags must be passed explicitly through the component tree or a context; never read `process.env` from a Client Component.
- Adding a new flag: add a row to this table, set default to `false`, gate the new code path, add the flag to the Vercel environment variables for staging before merging.

## Flags from earlier workstreams

For flags predating this file (e.g. `DESIGN_CONTEXT_ENABLED`, `FEATURE_DESIGN_SYSTEM_V2`), see `CLAUDE.md` → *Design System Architecture* sections.
