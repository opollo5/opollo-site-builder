# World-class UI polish — parent plan

> **Status:** plan-only. Phase 2 implementation halts on Steven's approval of this PR.
> **Required env vars:** none new.
> **Iteration budget:** ~25 PRs (soft cap 30 per workstream brief).

## What it is

A foundation-then-per-screen polish pass that lifts every admin surface to a quality bar where it could ship alongside Linear, Vercel, Stripe, Raycast, or Arc. Standalone workstream — runs after the UX overhaul (PR #215–#228), assumes that work as the new baseline.

Quality target by the time Phase 2 closes: every screen scores 4+ across all 12 dimensions in `world-class-polish-review.md`. Concretely — Linear-density lists, status pills that don't drift in colour or weight per surface, every loading path has a skeleton, every empty state has a primary action, motion is purposeful and reduced-motion-respecting, dark mode actually works, and ⌘K opens a real command palette.

## Cross-cutting decisions (apply across all sub-slices)

| Decision | Choice | Why |
|---|---|---|
| **Animation library** | CSS-only for primitives; reuse RS-0's `.transition-smooth` + `opollo-fade-in/out/slide-up` tokens; no Framer Motion | Already shipped + reduced-motion-respecting; one dep less |
| **Icons** | `lucide-react` (new dep) | Industry standard; tree-shakes per-icon; matches shadcn ecosystem |
| **Skeleton library** | Tailwind `animate-pulse` wrapped in a `Skeleton` primitive | Zero deps; same approach as shadcn's Skeleton |
| **Command palette** | `cmdk` (already installed); new global `<CommandPalette/>` mounted in admin layout | Consistent with BP-4 picker + BP-8 combobox |
| **Toast** | `sonner` (new dep) | Smaller + better DX than radix-toast; same approach shadcn took in 2024 |
| **Empty state pattern** | `<EmptyState icon iconLabel title body cta>` primitive | Stops three drifting variants today |
| **Status pill** | `<StatusPill kind="active|paused|warning|error|neutral|info" />` primitive | Replaces 31+ ad-hoc `bg-emerald-500/10 text-emerald-700` blocks |
| **Heading scale** | New `<H1>/<H2>/<H3>/<Eyebrow>` typography primitives via CVA | Pulls every page off `text-xl/text-2xl` raw classes |
| **Density target** | Linear/Vercel range — 12–18 list items per 1080px viewport, 4px–8px row spacing, 11–13px badges, 40–56px row heights | UX overhaul brief baseline |
| **Visual-regression screenshots** | Playwright deterministic capture at 1440×900 desktop + 380×844 mobile; before/after committed in every per-screen PR description | Brief hard rule |
| **Animation duration tiers** | 150ms (micro), 250ms (state change), 400ms (cross-page), 600ms (count-up) | Single source of truth in motion library |
| **Microcopy register** | Specific to Opollo, action-oriented, no AI tropes | Brief microcopy standard |
| **Concurrent-session safety** | Rebase on `origin/main` before every push; resolve conflicts in favour of preserving both changes | Brief warning |

## Required env vars

None new. The polish pass is purely UX/visual; no new external services.

---

## Audit findings — current quality scores

Scored 1–5 against the 12 dimensions, where 5 is world-class. **Bold** dimensions are the ones the polish pass moves the most.

### Cross-cutting baseline

| Dimension | Score | Evidence |
|---|---|---|
| **1. Motion** | 3 | RS-0 `.transition-smooth` / `opollo-fade-in/out` + `prefers-reduced-motion` zeroing in place. `slide-up` defined but unused. No list-reorder animation, no count-up except RunCostTicker. |
| **2. Live data** | 4 | RS-4 polling hook + RunCostTicker count-up are best-in-class. Other surfaces (batches, briefs, posts) still rely on `router.refresh()`. |
| **3. Empty states** | 2 | Three drifting variants (`border-dashed p-8`, `border-muted-foreground/20 bg-muted/20`, plain `border p-8`). Some have CTAs, most don't. |
| **4. Loading states** | 1 | Zero `<Skeleton/>`s. Most pages render blank → `Loading…` text → populated. Appearance panel + Design system pages worst offenders. |
| **5. Density** | 2 | Layout caps at `max-w-5xl`; cards at `p-4`/`space-y-3`/`space-y-8`. Sites list ~6/1080px (target 12+). |
| **6. Typography** | 4 | Disciplined `font-medium`/`font-semibold`/`font-mono` distribution. No real heading scale though — `<h1 text-xl>` ad-hoc per page. |
| **7. Color** | 3 | HSL token system clean; zero hex. But status colours hand-rolled per surface (`bg-emerald-500/10 text-emerald-700` repeated 31×). Dark mode tokens defined but no `dark:` variants in components. |
| **8. Microinteractions** | 2 | Buttons have CVA hover/focus rings. Tables have `hover:bg-muted/40`. No tactile form feedback, no slide/fade on dropdown opens beyond Radix defaults. |
| **9. Keyboard** | 2 | Escape closes modals. No global ⌘K. AdminNav dropdown is mouse-only. No shortcut cheat-sheet. |
| **10. Speed perception** | 2 | RS-4 polling fixed run surface. Save-draft → router.push is sync; no optimistic UI. |
| **11. Mobile** | 3 | RS-0 added 44×44 tap targets + 380px floor on the surfaces it touched. Other admin surfaces unaudited at 380px. |
| **12. Accessibility** | 3 | Focus rings on inputs/buttons consistent. ARIA on alerts/dialogs. No skip-link, no audit at WCAG-AA contrast level, no screen-reader testing. |

### Per-screen score grid (audit reconnaissance)

| Screen | Motion | Live | Empty | Loading | Density | Type | Color | Micro | KB | Speed | Mob | A11y |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/admin/sites` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/settings` | 3 | n/a | n/a | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/briefs/[id]/review` | 3 | 3 | n/a | 2 | 3 | 4 | 3 | 3 | 3 | 3 | 4 | 3 |
| `/admin/sites/[id]/briefs/[id]/run` | **5** | **5** | n/a | 2 | 3 | 4 | 4 | 4 | 3 | **5** | **5** | 4 |
| `/admin/sites/[id]/posts` | 3 | 3 | 3 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/posts/new` | 4 | 3 | n/a | 2 | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 3 |
| `/admin/sites/[id]/posts/[id]` | 3 | 3 | n/a | 1 | 2 | 3 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/pages` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/pages/[id]` | 3 | 3 | n/a | 1 | 2 | 3 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/sites/[id]/appearance` | 3 | 2 | n/a | **1** | 2 | 4 | 3 | 2 | 2 | 1 | 3 | 3 |
| `/admin/sites/[id]/design-system/*` | 3 | 3 | 2 | 2 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/batches` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/batches/[id]` | 3 | 3 | n/a | 1 | 3 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/images` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/images/[id]` | 3 | 3 | n/a | 1 | 2 | 3 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/admin/users` | 3 | 3 | 2 | 1 | 2 | 4 | 3 | 2 | 2 | 2 | 3 | 3 |
| `/login`, `/auth/*` | 3 | n/a | n/a | n/a | 3 | 4 | 3 | 3 | 3 | 3 | 4 | 3 |

The brief-runner surface (`/run`) sits at the polish bar already (5 across motion/live/speed/mobile from RS-0–RS-6 work). Every other surface lags on **loading** (1 across the board) and **density** (2 across the board) because the foundation primitives don't exist yet.

---

## Sub-slice breakdown

Three phases. **Phase A foundation must complete in full before Phase B starts. Phase B per-screen must complete before Phase C cross-cutting starts.** No sub-slice may inline a primitive that hasn't shipped.

### Phase A — Foundation primitives (8 PRs, ~5 days)

| # | PR | Scope | Effort | Blocks on |
|---|---|---|---|---|
| **A-0** | `chore(polish): screenshot harness` | Playwright config (1440×900 + 380×844), `scripts/screenshot-admin.ts` that captures every admin route to `playwright-screenshots/`, baseline commit, doc snippet for PR descriptions | S | — |
| **A-1** | `feat(polish): typography primitives + scale documentation` | `<H1>/<H2>/<H3>/<Eyebrow>/<Lead>` via CVA. Documented type scale in `app/globals.css` comment block. Sweep removes `text-xl font-semibold` raw uses on page headings (sites, batches, users, design-system, briefs lists) | S | A-0 |
| **A-2** | `feat(polish): semantic color tokens + status palette` | Add `--success`, `--warning`, `--info` HSL tokens to `app/globals.css` (light + dark). Wire into `tailwind.config.ts` so `bg-success/10 text-success` works. Documents the canonical palette in a comment block. No component changes — pure foundation. | S | A-1 |
| **A-3** | `feat(polish): motion library extension` | Adds `.opollo-shimmer` (skeleton), `.opollo-stagger-in-{1..8}` (list reveal), `.opollo-pulse-soft` (live-data tick), `.opollo-pop-in` (count-up landing). All gated by `prefers-reduced-motion`. Documents the four-tier duration system (150 / 250 / 400 / 600). | S | A-1 |
| **A-4** | `feat(polish): badge + statuspill primitives` | New `components/ui/badge.tsx` (CVA variants) + `components/ui/status-pill.tsx` (`kind="active|paused|warning|error|neutral|info|generating"`, `density="compact|default"`). Replaces every hand-rolled status pill in the codebase as part of this PR (sweep). | M | A-2 |
| **A-5** | `feat(polish): skeleton + loading shell primitives` | `components/ui/skeleton.tsx` + `<TableSkeleton rows cols />` + `<CardSkeleton />` + `<DefinitionListSkeleton rows />`. Uses `.opollo-shimmer` from A-3. No consumer changes — Phase B per-screen PRs wire them up. | S | A-3 |
| **A-6** | `feat(polish): empty + alert + toast primitives` | `components/ui/empty-state.tsx` (icon + title + body + CTA), `components/ui/alert.tsx` (extracts ConfirmActionModal pattern), `sonner` toast install + `<Toaster/>` mounted in `app/admin/layout.tsx`. | M | A-4 |
| **A-7** | `feat(polish): icon library + bootstrap icons sweep` | Installs `lucide-react`. Replaces text glyphs (`▼`, `›`, `×`, `↑`, `↓`, `→`, `…`) with Lucide icons in shipped UI primitives + AdminNav. Documents which icon to use for which intent. | S | A-3 |

### Phase B — Per-screen polish (15 PRs, ~7 days)

Each PR owns one surface. Hard rule: only consume Phase A primitives — no inline `bg-emerald-500/10`, no hand-rolled skeletons. Visual-regression screenshots in PR description (desktop + mobile) for every screen the PR touches.

| # | PR | Screen(s) | Effort | Blocks on |
|---|---|---|---|---|
| **B-1** | `feat(polish): admin layout + nav` | `app/admin/layout.tsx`, `components/AdminNav.tsx`, `components/Breadcrumbs.tsx` — sidebar/topbar density, focus rings, mobile sheet menu, breadcrumb consistency | M | A-1, A-7 |
| **B-2** | `feat(polish): sites list` | `/admin/sites` — Linear-density table, `<StatusPill/>`, `<TableSkeleton/>`, `<EmptyState/>`, hover/focus refinement | M | A-4, A-5, A-6 |
| **B-3** | `feat(polish): site detail` | `/admin/sites/[id]` — sidebar density, batches/briefs lists with skeletons, info hierarchy, status pill sweep | M | B-2 |
| **B-4** | `feat(polish): site settings` | `/admin/sites/[id]/settings` — narrower form column, polish field spacing, save toast via `sonner` | S | A-6 |
| **B-5** | `feat(polish): brief review` | `/admin/sites/[id]/briefs/[id]/review` — fold to foundation primitives, polish editable list | M | A-4, A-5, A-6 |
| **B-6** | `feat(polish): brief run surface` | `/admin/sites/[id]/briefs/[id]/run` — already ships at the bar from RS-*; this PR just folds it to consume Phase A primitives instead of its inline copies | S | A-4, A-5 |
| **B-7** | `feat(polish): posts list + detail` | `/admin/sites/[id]/posts` and `/admin/sites/[id]/posts/[id]` — list density, definition-list polish, action button cluster | M | A-4, A-5, A-6 |
| **B-8** | `feat(polish): blog post entry-point` | `/admin/sites/[id]/posts/new` — fold BlogPostComposer to Phase A primitives, polish source-hint affordance | M | A-4, A-7 |
| **B-9** | `feat(polish): pages list + detail` | `/admin/sites/[id]/pages` and `/admin/sites/[id]/pages/[id]` — table density, definition list polish | M | A-4, A-5, A-6 |
| **B-10** | `feat(polish): appearance panel` | `/admin/sites/[id]/appearance` — first-paint skeletons (worst offender today; pages render blank for ~600ms), status pills, audit-log polish | M | A-5, A-6 |
| **B-11** | `feat(polish): design-system surfaces` | `/admin/sites/[id]/design-system/*` (4 routes) — table densities, loading states, modals fold to Phase A primitives | M | A-4, A-5, A-6 |
| **B-12** | `feat(polish): batches list + detail` | `/admin/batches` and `/admin/batches/[id]` — slot table density, sidebar event log polish, status pills | M | A-4, A-5, A-6 |
| **B-13** | `feat(polish): images library + detail` | `/admin/images` and `/admin/images/[id]` — explore grid view alongside table, filter form polish, definition-list polish | M | A-4, A-5, A-6 |
| **B-14** | `feat(polish): users list` | `/admin/users` — table density, role/status action cells polish, invite modal polish | S | A-4, A-5, A-6 |
| **B-15** | `feat(polish): auth surfaces` | `/login`, `/auth/forgot-password`, `/auth/reset-password` — typography, alert primitive, polish | S | A-1, A-6 |

### Phase C — Cross-cutting features (3 PRs, ~3 days)

| # | PR | Scope | Effort | Blocks on |
|---|---|---|---|---|
| **C-1** | `feat(polish): command palette + ⌘K` | New `components/CommandPalette.tsx` mounted in `app/admin/layout.tsx`. Routes: navigate to every admin surface; quick-actions: "Create site", "Upload brief on…", "New post on…". Recent items via `localStorage`. | M | A-7, B-1 |
| **C-2** | `feat(polish): optimistic UI patterns` | Optimistic update helpers for: budget edit save, role/status flips on users, brand-voice save, post save-draft. Roll-back on server error. Toast feedback via `sonner`. | M | A-6 |
| **C-3** | `feat(polish): accessibility hardening sweep` | Skip-to-content link in admin layout. Focus-visible normalization across every interactive primitive. WCAG-AA contrast audit (`@axe-core/playwright` integrated into the screenshot harness). Aria sweep on icon-only buttons. | M | B-1..B-15 (all per-screen PRs ship first so we audit a stable surface) |

### Operator review handoff (1 PR)

| # | PR | Scope |
|---|---|---|
| **R-0** | `report: world-class polish pass — operator review needed` | `docs/reports/world-class-polish-review.md` with one section per screen, before/after screenshots from the harness, 12-dimension re-scoring, self-identified remaining gaps. **Do NOT auto-merge.** Halt with: "Polish pass implementation complete. Operator review pending in PR #[number]." |

**Total: 8 (A) + 15 (B) + 3 (C) + 1 (R) = 27 PRs.** Within the 30-PR ceiling with 3 PRs of slack for unexpected sub-slice splits.

---

## Execution order

```
[serial]   A-0 (screenshot harness) — must ship before any per-screen work
[serial]   A-1 (typography)
[parallel] A-2 (color tokens) ─┐
[parallel] A-3 (motion lib)    ┘
[serial]   A-4 (badge / pill)  — uses A-2
[parallel] A-5 (skeleton)      ┐ — uses A-3
[parallel] A-6 (empty/alert/toast) │ — uses A-4
[parallel] A-7 (lucide icons)  ┘ — uses A-3
─── PHASE A COMPLETE ────────────────────────────────────
[serial]   B-1 (layout + nav) — every other B-* depends on this for breadcrumb / shell
[parallel] B-2..B-15 in dependency-free pairs/triples after B-1
─── PHASE B COMPLETE ────────────────────────────────────
[parallel] C-1 (command palette) ─┐
[parallel] C-2 (optimistic UI)    │
[serial]   C-3 (a11y sweep)       ┘ — runs LAST since it audits the stable surface
─── PHASE C COMPLETE ────────────────────────────────────
[serial]   R-0 (operator review report) — HALT
```

Phase B parallelism: B-2/B-3 share files (sites list/detail) so serial. B-9 (pages) is independent of B-7 (posts). B-11 (design system) is independent of everything except A-*. Up to ~3 B-* PRs can be in flight if branches don't share files. Per the standing concurrent-session warning, every push rebases on `origin/main` first.

---

## Per-sub-slice acceptance criteria

Every Phase B/C PR MUST meet ALL:

1. **Visual regression screenshots in PR description.** Before/after at 1440×900 desktop AND 380×844 mobile for every screen the PR touches. Generated via `scripts/screenshot-admin.ts` (A-0). PR body includes the file paths under `playwright-screenshots/`.
2. **Mobile 380px viewport check.** No horizontal scroll. 44×44 tap targets on every interactive control.
3. **Reduced-motion check.** Open the page with `prefers-reduced-motion: reduce` (Chrome DevTools rendering tab) — every animation zeros out.
4. **Keyboard navigation check.** Every primary action keyboard-reachable. Tab order intentional. Escape closes modals.
5. **Accessibility check.** Focus states visible. Color contrast ≥ WCAG AA (verified via the `@axe-core/playwright` integration landing in C-3 — for B-* PRs, manual DevTools contrast check until then).
6. **Standard CI gates.** `npm run lint` + `npm run typecheck` + `npm run build` green.
7. **Microcopy review.** Every user-facing string Opollo-specific, action-oriented, no AI tropes.

Every Phase A PR MUST meet:

1. Standard CI gates green.
2. The new primitive renders in isolation (one-off page or component example) at desktop + mobile.
3. `prefers-reduced-motion` honoured if the primitive has motion.
4. Tree-shake-friendly export (no `index.ts` re-export soup; per-component file).

---

## Write-safety contract (parent-level)

- **No new write paths.** Every sub-slice is UX-layer. Existing CAS / version_lock / idempotency contracts are preserved.
- **No schema migrations.** Every primitive is client-side rendering only. No DB columns added or modified.
- **No prompt or model changes.** Anthropic-facing code unmodified.
- **No public API contract changes.** Endpoints unchanged in shape; only consumer rendering changes.

## Risks identified and mitigated (parent-level)

| Risk | Mitigation |
|---|---|
| **Foundation churn cascading into in-flight per-screen PRs** | Hard rule: Phase A ships in full before Phase B opens. No B-* branches off pre-foundation main. |
| **Inline polish creep — "I'll just add a hover here"** | Acceptance criterion: Phase B PRs may NOT inline new primitives. If you need a primitive that doesn't exist, halt and ship a Phase A extension first. |
| **Visual-regression screenshot drift** | Playwright deterministic at fixed viewport + UTC clock + seeded data. Harness runs on every Phase B PR, screenshots committed to PR body (not repo — keeps git history light). |
| **Iteration spiral — infinite micro-polish** | 30-PR ceiling enforced. Halt at 25 PRs without per-screen complete: "approaching iteration budget — review remaining work, request greenlight to continue." |
| **Sonner / lucide-react bundle bloat** | `@next/bundle-analyzer` run at A-6 + A-7 ship time; tree-shaking validated. Sonner is ~3KB gzipped; lucide imports are per-icon. |
| **Dark mode regression** | A-2 + per-screen PRs add `dark:` variants. Manual DevTools toggle on every B-* screenshot review. Capture both modes if dark surfaces materially differ. |
| **Concurrent session conflicts on shared files** | Brief warning: rebase before push, resolve preserving both changes. Phase B serializes any sub-slice that touches shared shell (B-1 shell touches everything). |
| **Operator review bottleneck** | R-0 explicitly does NOT auto-merge — Steven sees the consolidated review report, sends back specific feedback, iteration follows. Mid-stream surprises captured to BACKLOG instead of inline-fixing. |

## Out of scope (deferred to BACKLOG with triggers)

- **Brand redesign** — logo, typography license, marketing site. Trigger: marketing site refresh project.
- **Customer-facing WP themes** — admin polish only. Trigger: when first customer asks for a theme refresh.
- **Print stylesheets, email templates** — admin doesn't print or email. Trigger: never.
- **i18n / translation surface** — English only for v1. Trigger: first non-English-speaking customer.
- **Native mobile apps** — responsive web only. Trigger: an operator complaining about mobile-web friction the responsive pass can't fix.
- **Drag-to-reorder for lists** — every list today is server-sorted. Trigger: operator request for re-orderable page or post lists.
- **Theme picker / per-user preferences** — single dark/light per system. Trigger: operator request for per-user preferences.

## Pointers

- `docs/patterns/ship-sub-slice.md` — every PR follows this shape.
- `docs/plans/run-surface-ux-overhaul-parent.md` — RS-0 motion + Radix primitives are the foundation Phase A extends, not replaces.
- `docs/plans/blog-post-workflow-parent.md` — BP-4 ImagePicker, BP-8 WpPageCombobox already exemplify the polish bar; reference as we polish the rest.
- `app/globals.css` — the canonical place for tokens; A-2 + A-3 extend it.
- `components/ui/` — the canonical home for primitives; A-1, A-4, A-5, A-6 add to it.

## Sub-slice status tracker

(filled in as PRs land)

| Slice | PR | Merged | Notes |
|---|---|---|---|
| A-0 screenshot harness | — | — | — |
| A-1 typography | — | — | — |
| A-2 color tokens | — | — | — |
| A-3 motion lib | — | — | — |
| A-4 badge / status pill | — | — | — |
| A-5 skeletons | — | — | — |
| A-6 empty / alert / toast | — | — | — |
| A-7 icon library | — | — | — |
| B-1 layout + nav | — | — | — |
| B-2 sites list | — | — | — |
| B-3 site detail | — | — | — |
| B-4 site settings | — | — | — |
| B-5 brief review | — | — | — |
| B-6 brief run | — | — | — |
| B-7 posts list + detail | — | — | — |
| B-8 blog post entry | — | — | — |
| B-9 pages list + detail | — | — | — |
| B-10 appearance | — | — | — |
| B-11 design system | — | — | — |
| B-12 batches | — | — | — |
| B-13 images | — | — | — |
| B-14 users | — | — | — |
| B-15 auth | — | — | — |
| C-1 command palette | — | — | — |
| C-2 optimistic UI | — | — | — |
| C-3 a11y hardening | — | — | — |
| R-0 operator review | — | — | — |
