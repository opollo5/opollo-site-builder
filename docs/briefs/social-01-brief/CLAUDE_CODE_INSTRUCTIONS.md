# Opollo Social-01 Brief — Master Instructions for Claude Code

**You are Claude Code working autonomously inside `/c/Users/StevenMorey/dev/opollo-site-builder`.**
**This brief is at `docs/briefs/social-01/`.**

This brief is **self-contained and autonomous.** Every decision is locked. Every artefact you need is in this folder. Do not ask the user clarifying questions — every plausible question already has an answer in `DECISIONS_LOCKED.md`. If you find something genuinely ambiguous, default to the recommendation in `DECISIONS_LOCKED.md` §99 ("Tiebreakers") and proceed.

---

## What's in this brief

There are **two parallel workstreams.** They share design tokens and a few primitives, but otherwise do not block each other. Work on them in this order:

1. **`composer/`** — Social Composer rebuild (the priority). Replaces `/company/social/poster` and the existing composer. Spec sits in repo at `docs/specs/22-social-composer.md` (Spec 22). This brief supersedes Spec 22 where they conflict.
2. **`framework/`** — Frontend Template Framework. Sixteen named templates collapsing the 80 cluster IDs from the 82-route audit into a buildable system. Ship after the composer or in parallel if you have capacity.

Files at this level (`docs/briefs/social-01/`):

| File | Purpose |
|---|---|
| **`CLAUDE_CODE_INSTRUCTIONS.md`** | This file. Start here. |
| **`DECISIONS_LOCKED.md`** | Every decision that was previously "awaiting sign-off." All locked. |
| **`ARCHITECTURE_GUARDRAILS.md`** | How to structure code — abstraction rules, anti-patterns, state-management ladder, server/client policy. Read after DECISIONS_LOCKED. |
| **`SERVICE_HEALTH.md`** | In-house service health monitoring — wraps every external API call, notifies platform admins on failures. Referenced by PR B. |
| **`README.md`** | Human-facing overview for directors. You can ignore for build purposes. |

Files inside `composer/`:

| File | Purpose |
|---|---|
| `COMPOSER_BUILD_BRIEF.md` | Composer workstream entry point — read this second |
| `SPEC_v1.3.docx` | Product spec (supersedes Spec 22). Read in full before PR A. Where this spec and `../DECISIONS_LOCKED.md` conflict, DECISIONS_LOCKED wins. |
| `SCHEDULING_PROPOSAL.docx` | Full scheduling state machine + state diagrams |
| `SCHEMA.md` | Database schema delta with exact column types |
| `API_CONTRACTS.md` | Every endpoint with TypeScript request/response interfaces |
| `COMPONENT_MAP.md` | Wireframe class names → React component file paths |
| `BUILD_ORDER.md` | PRs in dependency order with verification gates |
| `ACCEPTANCE.md` | Per-PR acceptance checks Claude Code can self-verify |
| `ENV.md` + `.env.example` | Required environment variables |

Files inside `framework/`:

| File | Purpose |
|---|---|
| `FRAMEWORK_BUILD_BRIEF.md` | Framework workstream entry point |
| `PASS_1_FRAMEWORK.docx` | The 16-template framework with all D-decisions locked |
| `TEMPLATES.md` | Every template spec in one document. ~500 words each. |
| `TEMPLATE_DOD.md` | Per-template + per-route-migration Definition of Done checklist. Use on every framework PR. |
| `WAVE_PLAN.md` | Build order across the four waves, with route lists per template |

Files inside `wireframes/`:

| File | Purpose |
|---|---|
| `*.html` | 13 wireframes for visual reference. Map class names to React components via `composer/COMPONENT_MAP.md`. |
| `tokens.css`, `styles.css` | Design tokens and component CSS. Tokens map 1:1 to existing `app/globals.css`. |
| `sprite.js`, `interactions.js` | Icon library and reference interactions. Translate to React hooks. |

Files inside `migrations/`:

| File | Purpose |
|---|---|
| `0131_recurring_drafts.sql` | Adds `parent_draft_id`, `recurrence_rule`, `recurrence_state` to `social_post_drafts` |
| `0132_planned_for_at.sql` | Adds `planned_for_at` for the draft tab |
| `0133_published_metadata.sql` | Adds `published_url`, `published_at`, `last_publish_error` |
| `0134_analytics_cache.sql` | Adds `social_post_analytics_cache` (primary cache, not Redis) + `social_post_approval_decisions` |
| `0135_cron_infrastructure.sql` | Adds `cron_heartbeats` + `service_health_events` tables for in-house cron + service monitoring |

---

## How to work this brief

### Step 1: Read in this order, then begin
1. This file (you're here).
2. `DECISIONS_LOCKED.md` — top to bottom. Every decision is final.
3. `ARCHITECTURE_GUARDRAILS.md` — how to structure code. Apply throughout build.
4. `SERVICE_HEALTH.md` — service health monitoring. Read before PR B; PR B builds this system.
5. `composer/COMPOSER_BUILD_BRIEF.md` — composer entry point.
6. `composer/SPEC_v1.3.docx` — full product spec.
7. `composer/SCHEMA.md`, `API_CONTRACTS.md`, `COMPONENT_MAP.md` — technical contracts.
8. `composer/BUILD_ORDER.md` — your PR sequence.

### Step 2: Build the composer in PR order
`BUILD_ORDER.md` defines 8 PRs (A through H). Build them in order. Each PR has:
- An exact scope (which files to create/modify)
- A verification gate (commands you run before considering the PR done)
- Self-checks (typecheck, lint, build, smoke tests)

**Do not move to the next PR until the current PR's verification gate passes.** If a gate fails, fix it in the same PR. Do not create a follow-up PR for gate failures.

### Step 3: Frontend Template Framework (after composer ships, or in parallel)
Open `framework/FRAMEWORK_BUILD_BRIEF.md`. Build templates in the Wave order documented there. Each wave is ~4 templates and takes ~2 weeks of focused work.

---

## Repo conventions Claude Code must follow

These are non-negotiable. They are codified in this brief because they have been violated repeatedly in the past:

1. **Feature flag.** The composer rebuild ships behind `FEATURE_COMPOSER_V2` (already in `lib/feature-flags.ts`). Do NOT remove the old composer. Add the new one as a parallel mount. Cutover is a separate PR (PR I, not in this brief).
2. **Bucket name.** Use the existing `social-media-uploads` Supabase Storage bucket. Do NOT create a new bucket.
3. **CAP endpoint.** Use existing `/api/platform/social/cap/generate`. Do NOT invent `/cap/generate` or similar.
4. **Spec 22 reconciliation.** This brief overrides Spec 22's V1 exclusions for: per-platform variants (now in V1), publish-regularly (now in V1), bulk CSV→composer (now in V1). Spec 22 V1 exclusions that still hold: mobile composer, multi-image carousel, A/B variant testing.
5. **App shell.** Use existing `components/platform/AppShell.tsx` (or whatever its actual path is — find it with `git grep -l 'AppShell'`). Do NOT build a new top bar or sidebar. If the current shell varies across pages, that is a pre-existing bug — see `DECISIONS_LOCKED.md` D-3 for resolution.
6. **No localStorage/sessionStorage in artefacts.** Composer state lives in React state + URL params + database. No browser storage.
7. **Migrations.** Use the next available migration number sequence (0131, 0132, 0133, 0134, 0135). If migration numbers have moved since this brief was written, renumber but preserve the order.
8. **Branding tokens are locked.** Primary `#FF03A5`, green `#00E5A0`, display font `EmBauhausW00`, body font `Inter`. Tokens are already in `app/globals.css`; reuse them. Do not introduce new colour or font tokens.
9. **Vendor reduction.** This brief deliberately self-hosts scheduling (Vercel Cron + Postgres polling) and caching (Postgres cache table) rather than using Upstash QStash or Upstash Redis. Do NOT reintroduce Upstash. If an external service is needed for a new concern, default to self-hosting unless deliverability/quality/scale makes it infeasible (see `DECISIONS_LOCKED.md` A16).
10. **Every external API call is wrapped.** Calls to bundle.social, Ideogram, SendGrid, Anthropic, Supabase Storage all go through `withHealthMonitoring(service, operation, fn)` from `lib/platform/service-health/monitor.ts`. Raw `fetch()` to external services outside this wrapper will fail the audit:static script eventually. See `SERVICE_HEALTH.md`.

---

## When you genuinely cannot proceed

If after reading `DECISIONS_LOCKED.md` and all referenced files you encounter a situation that is genuinely unresolved, take the following actions in order:

1. **Search the existing repo.** `git grep`, look at `docs/specs/`, look at `CLAUDE.md`. The answer is probably already there.
2. **Default to the safest interpretation.** Prefer additive changes over destructive ones. Prefer feature-flagged paths over removing old code. Prefer adding a TODO comment over guessing on behaviour.
3. **Document the assumption.** Add a `// CLAUDE-ASSUMPTION:` comment in the code with one sentence explaining what you assumed and why.
4. **Continue building.** Do not stop. Do not ask the user. The brief is autonomous; assumptions that turn out to be wrong are fixable in review.

The user will review at the end. Reviewing is faster than re-syncing context every time something is ambiguous.

---

## Definition of done

The composer workstream is complete when:

1. All 8 PRs (A through H) in `composer/BUILD_ORDER.md` are merged behind `FEATURE_COMPOSER_V2`.
2. The acceptance checklist in `composer/ACCEPTANCE.md` passes end-to-end.
3. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all pass on the merged branch.
4. A smoke run of `pnpm test:e2e composer` passes with the feature flag enabled.
5. The DECISION_TRAIL section at the bottom of `composer/ACCEPTANCE.md` lists every `CLAUDE-ASSUMPTION:` comment introduced, for the user's review.

The framework workstream is complete when:

1. All 16 templates in `framework/TEMPLATES.md` have a corresponding `templates/*.tsx` component in the repo.
2. Every route in the 82-route audit is migrated to its target template (per `framework/WAVE_PLAN.md`).
3. The R-divergences listed in `framework/TEMPLATES.md` §"Resolved divergences" are no longer present (verifiable via `pnpm audit:static`).
4. The `audit:static` script enforces the framework rules going forward.

Both workstreams will likely take 8–14 weeks of autonomous work. Pace yourself; verify gates strictly; do not skip ahead.

---

## One last thing

Steven Morey is the director sponsor. He is direct, commercially focused, and prefers honest assessments over optimistic ones. If during build you discover the brief has a factual error (wrong file path, wrong column type, wrong API contract that conflicts with a downstream consumer), document it in `DECISION_TRAIL` and proceed with the corrected version. Do not pretend the brief was right when it was wrong; do not paper over with workarounds.

The brief was written to be buildable autonomously. Build it.
