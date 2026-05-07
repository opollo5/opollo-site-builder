# Spec 02 — Platform PageHeader, breadcrumbs, type scale

> **2026-05-08 amendment:** slot order reversed to Title → Breadcrumb → Subtitle → Meta → Actions. Rhythm spec added (20/8/12/32 gaps). Title weight bumped 600→700. See Spec 04 PR A.

**Owner:** Steven
**Audience:** Claude Code
**Mode:** Autonomous build. Do not stop to ask questions. Every decision is locked. Pause only for genuinely missing env vars or contradictions with `docs/ARCHITECTURE.md`.

**Estimated PRs:** 3 — (1) primitives + tokens, (2) admin route adoption, (3) audit:static rules
**Blocks:** UAT readiness — typographic hierarchy and consistent navigation
**Depends on:** Nothing structural. Can run in parallel with Spec 01.

---

## 0. Read this first

Read `docs/ARCHITECTURE.md` sections 13 (frontend conventions), 17 (in-flight workstreams), and 18 (refactor boundaries) before writing code.

Relevant facts:

- §13.3: typography minimum is `text-base` (16px) body, `text-sm` (15px) helper, `text-xs` overridden to 15px sitewide. Lucide icons floor at 20px. **Body and helper floors stay; this spec adds H1/H2/H3 ceilings on top.**
- §17: `npm run audit:static` runs typography checks. Tightening rules is a small PR. Loosening requires `docs/RULES.md` justification.
- §18: `components/ui/*` is freely refactorable. Setup wizards' flow logic is freely refactorable. Admin sidebar is freely refactorable.

---

## 1. PR 1 — Primitives and tokens

Three new components in `components/ui/`. Single PR. No admin routes change yet.

### 1.1 `components/ui/page-header.tsx`

Compound component pattern.

```tsx
<PageHeader>
  <PageHeader.Breadcrumb segments={[
    { label: "Admin", href: "/admin/sites" },
    { label: "Sites", href: "/admin/sites" },
    { label: "Test Site 2" }   // last segment, no href
  ]} />
  <PageHeader.Title>Test Site 2</PageHeader.Title>
  <PageHeader.Subtitle>Optional one-line description.</PageHeader.Subtitle>
  <PageHeader.Meta>
    <StatusPill kind="active" />
    <a href={wpUrl}>{wpUrl}</a>
    <span className="text-sm text-muted">Tested 2h ago</span>
  </PageHeader.Meta>
  <PageHeader.Actions>
    <Button>Run Batch</Button>
  </PageHeader.Actions>
</PageHeader>
```

Behavior:

- Each subcomponent is optional except Title.
- **Compound component identity is detected via `displayName`, NOT reference equality on `child.type`.** Reference equality breaks under HMR, when components are wrapped in `forwardRef` or `memo`, and when modules are duplicated across bundles. Implementation: each subcomponent has `Component.displayName = 'PageHeaderTitle'` (and `'PageHeaderBreadcrumb'`, `'PageHeaderSubtitle'`, `'PageHeaderMeta'`, `'PageHeaderActions'`). The parent walks `React.Children.toArray(children)` and filters by `child.type?.displayName`.
- Title presence enforcement: **runtime invariant in development only.** If `process.env.NODE_ENV !== 'production'` and no Title child is found, log a `console.error` with the calling route path. Do NOT throw. Do NOT attempt TypeScript-discriminated-children typing — React children typing for compound layouts is notoriously painful with fragments, conditionals, arrays, and server components, and the runtime check + audit rule (PR 3) is sufficient enforcement.
- Visual order is enforced regardless of JSX order: Breadcrumb → Title → Subtitle → Meta → Actions. Children that match multiple slots: take first occurrence by displayName, drop subsequent matches with a dev `console.warn`.
- Multiple Title children: take first, dev warning.
- Multiple Actions children: take first, dev warning.
- Children that are React Fragments (`<>...</>`): unwrap one level of fragment before slot-matching, so `<><PageHeader.Title /></>` works the same as a direct child. Don't recursively unwrap deep fragments.
- Actions slot lives top-right. Right-aligned. Wraps under the title row on viewports < 640px.

Render layout:

```
┌─────────────────────────────────────────────────────┐
│ Admin › Sites › Test Site 2                         │  ← Breadcrumb (text-sm muted)
│                                                     │
│ Test Site 2                          [Run Batch]    │  ← Title row (text-page-title) + Actions right-aligned
│ Optional one-line description.                      │  ← Subtitle (text-base muted)
│ ● Active · https://test2... · Tested 2h ago        │  ← Meta row (small inline items, gap-4)
│                                                     │
└─────────────────────────────────────────────────────┘
                      [32px gap to content below]
```

Spacing tokens:

- Breadcrumb to Title: 8px
- Title to Subtitle: 4px
- Subtitle to Meta: 8px
- PageHeader bottom margin to next content: 32px (or inherit from PageShell)

### 1.2 `components/ui/breadcrumb.tsx`

Exported standalone for non-PageHeader uses. PageHeader.Breadcrumb is a thin wrapper around it.

Props:

```ts
interface BreadcrumbProps {
  segments: Array<{ label: string; href?: string }>;
}
```

Behavior:

- Last segment has no `href` and renders as plain text.
- All earlier segments have `href` and render as Next.js `<Link>` with hover underline.
- Separator: `ChevronRight` from `lucide-react`, 16px, muted color.
- **Mobile collapse rule (locked, no JS measurement):** on viewports < 640px (use a CSS media query, not a `useEffect` window check), if there are more than 2 segments total, render `First › … › Last` and skip the middle segments. The middle ellipsis is non-clickable. On viewports ≥ 640px, render all segments. This is a hardcoded media-query rule. Do NOT attempt dynamic overflow detection — pure CSS cannot truly measure semantic overflow, and JS measurement adds complexity for marginal benefit.
- Style class for segments: `text-sm` (15px), `text-muted-foreground` (or whatever the muted text token is in this codebase).

### 1.3 `components/ui/page-shell.tsx`

Layout primitive paired with PageHeader. Enforces consistent page padding, max-width, vertical rhythm.

```tsx
<PageShell>
  <PageHeader>...</PageHeader>
  <PageShell.Content>
    {/* page content */}
  </PageShell.Content>
</PageShell>
```

Decisions:

- Max-width selection algorithm:
  1. Grep `app/admin/**/page.tsx` for `max-w-` Tailwind classes.
  2. Tally the count of each value.
  3. If a single value appears in **more than 60% of files**, use that value.
  4. Otherwise, use **1280px** (`max-w-[1280px]`).
  5. Document the chosen value and the tally in the PR description.
- Horizontal padding: 32px desktop (≥1024px), 24px tablet (≥640px), 16px mobile.
- Vertical: PageHeader gets a 32px bottom margin before Content begins.
- Content slot has no inner padding — pages own their own grids.

### 1.4 Type scale tokens

Add to `app/globals.css` under the existing typography section:

```css
/* Page heading scale — Spec 02 */
.text-page-title {
  font-size: 28px;
  line-height: 1.15;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.text-section-title {
  font-size: 20px;
  line-height: 1.25;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.text-subsection {
  font-size: 16px;
  line-height: 1.4;
  font-weight: 600;
}

@media (max-width: 640px) {
  .text-page-title { font-size: 24px; }
}
```

Mapping:

- PageHeader.Title applies `text-page-title`.
- Card titles and section headers within a page apply `text-section-title`.
- Subsections within cards apply `text-subsection`.
- Existing body and helper rules unchanged.

Do not extend `tailwind.config.js`. Per ARCH §13.3, the floor enforcement lives in `app/globals.css` — match that pattern.

### 1.5 Tests

- `components/ui/__tests__/breadcrumb.test.tsx` — vitest:
  - Render with 1, 2, 3, and 5 segments
  - Last segment is plain text, not a link
  - Mobile collapse: at viewport width 320px, 5 segments renders as `First › … › Last`; 2 segments renders both segments
  - Desktop: at viewport width 1280px, all segments render regardless of count
- `components/ui/__tests__/page-header.test.tsx` — vitest:
  - Sub-component sorting (Actions before Title in JSX still renders Title above Actions visually)
  - `displayName`-based detection works when components are wrapped in `memo`
  - Missing-Title logs dev `console.error` (test the warning, don't test absence of throw)
  - Multiple Title children: first wins, dev warning fires
  - Multiple Actions children: first wins, dev warning fires
  - React Fragment children: `<><Title /></>` is treated as direct Title
  - Page with no Subtitle: assert no phantom gap between Title and Meta (snapshot test or computed-style check on the wrapper)
- No Storybook (not in this codebase). No Playwright in PR 1 (covered in PR 2).

### 1.6 Files touched in PR 1

- `components/ui/page-header.tsx` (new)
- `components/ui/breadcrumb.tsx` (new)
- `components/ui/page-shell.tsx` (new)
- `app/globals.css` (extend)
- `components/ui/__tests__/breadcrumb.test.tsx` (new)
- `components/ui/__tests__/page-header.test.tsx` (new)

---

## 2. PR 2 — Adoption sweep

Apply PageHeader / PageShell to every admin route in one PR. Mechanical work. PR description must include before/after screenshots of at least 4 routes (sites index, site detail, setup wizard, posts surface).

### 2.1 Route inventory

Walk `app/admin/**/page.tsx` and migrate every page. Expected list (verify by walking the directory):

- `/admin` (dashboard if present)
- `/admin/sites`
- `/admin/sites/[id]`
- `/admin/sites/[id]/edit`
- `/admin/sites/[id]/onboarding`
- `/admin/sites/[id]/setup`
- `/admin/sites/[id]/setup/extract`
- `/admin/sites/[id]/design-system` (and child routes)
- `/admin/sites/[id]/posts` (and child routes per M13-4)
- `/admin/sites/[id]/briefs/[brief_id]/run`
- `/admin/sites/[id]/briefs/[brief_id]/review`
- `/admin/companies` (and child routes)
- `/admin/users` (admin/super_admin only)
- `/admin/system/jobs` (super_admin only)
- `/admin/audit-log` (if present)
- `/admin/email-test` (super_admin)

For `app/account/**/page.tsx`: same migration but breadcrumb root is `Account ›` not `Admin ›`.

For `app/optimiser/**/page.tsx`: **skip in this PR.** Optimiser is a sibling domain per ARCH §2 with its own feature branch. Leave a TODO comment in `docs/ARCHITECTURE.md` §2 noting that optimiser routes should adopt PageHeader when its branch merges to main.

### 2.2 Breadcrumb root rules (locked)

- All `/admin/*` routes start with `Admin ›`. The "Admin" label links to `/admin/sites`. (No real admin dashboard at `/admin` exists today; `/admin/sites` is the de-facto home.)
- All `/account/*` routes start with `Account ›` linking to `/account`.
- Last segment is the current page, no link.
- Intermediate segments link to the index of that section (e.g., `Sites` links to `/admin/sites`).

### 2.3 Subtitle copy

For each existing page that has a description below the title, preserve the existing copy in `PageHeader.Subtitle`. Do not invent new copy. If a page has no current subtitle, omit `PageHeader.Subtitle`.

### 2.4 Meta row

Move existing inline status pills, URLs, and timestamps that currently sit below the page title into `PageHeader.Meta`.

Order of items in Meta:

1. Status pill
2. URL (as a link)
3. Timestamps (muted)
4. Anything else page-specific

Items separated by middle dot (`·`) with `gap-4` between items, vertically centered.

Drill-down nav like the "Pages →" link on the site detail page is **not** Meta — it is sub-navigation. For PR 2: render those drill-down links as a separate horizontal nav row directly below PageHeader, outside `PageHeader.Meta`. Do not build a `<PageNav>` primitive in this PR; if more than 3 routes need the same pattern, that becomes a future spec.

### 2.5 Actions row

Top-right CTAs: Run Batch, + New Site, Save Changes, etc. Move into `PageHeader.Actions`.

Secondary actions (the `⋯` overflow menu on rows) are not page-level and stay in their existing locations.

### 2.6 What to remove per route

After applying PageHeader to a route:

- Remove the hand-rolled breadcrumb in the page file.
- Remove the hand-rolled `<h1>` with custom class soup.
- Remove the hand-rolled "header bar" / "page top" inside the page body.
- Remove manual padding/margin between page top and content (PageShell handles 32px).

If something else in the page depends on the removed structure, fix the dependency rather than leaving the structure in place.

### 2.7 Special cases (locked behavior)

- **Setup wizards** have a step indicator (`1 Design direction · 2 Tone of voice · 3 Done`). It stays inside the page content, below PageHeader. Not absorbed into the header.
- **Run page** (`/admin/sites/[id]/briefs/[brief_id]/run`) keeps its polling-driven page-card auto-expand UX per ARCH §4.4. Only the page chrome (title, breadcrumb, primary action) moves into PageHeader.
- **Setup banners** ("Set up your design direction and tone of voice...") are *content-area inline banners*, not header elements. They stay in the content flow, below PageHeader.

### 2.8 Tests

- `e2e/page-header-adoption.spec.ts` — Playwright, navigate to 4 representative routes, assert breadcrumb exists with correct root, assert page title is rendered with `text-page-title` class, assert no raw `h1` outside PageHeader.

### 2.9 Files touched in PR 2

Every file in §2.1's route list, plus any shared layout files (`app/admin/layout.tsx`, `app/account/layout.tsx`).

---

## 3. PR 3 — Audit rules + cleanup

Add three new audit rules to `scripts/audit.ts` per ARCH §17.

### 3.1 Rule: `headings-use-page-header`

Static check. AST grep on every `page.tsx` under `app/admin/**`, `app/account/**`. Each file must import `PageHeader` from `@/components/ui/page-header`.

Severity: HIGH (gates CI).

Allowlist: empty at start. If any genuine exception exists (e.g., a print-only route), add to the allowlist with an inline comment explaining the exception.

### 3.2 Rule: `breadcrumb-required-when-page-header`

Static check. If a `page.tsx` imports PageHeader, the file must include `<PageHeader.Breadcrumb>` in its JSX. AST grep on JSX subcomponent usage.

Severity: HIGH (gates CI).

### 3.3 Rule: `no-raw-h1-in-pages`

Static check. `<h1>` JSX tags appearing **directly in `page.tsx`** outside of `<PageHeader.Title>` are forbidden.

Severity: HIGH (gates CI). The adoption sweep in PR 2 should leave zero violations, so HIGH is enforceable at PR 3 merge time.

Rule scope (locked to avoid false positives):

- Only matches **literal JSX `<h1>` nodes** that appear directly inside the default-exported component of a `page.tsx` file. Not nested imports.
- Excludes `<h1>` inside any expression that is the *child* of a `<PageHeader.Title>` element (so `<PageHeader.Title><h1>...</h1></PageHeader.Title>` doesn't fire — though that pattern is itself discouraged and will produce double styling).
- Excludes any usage where the h1 is inside a variable assignment that is then passed to `PageHeader.Title` (e.g., `const title = <h1>...</h1>; return <PageHeader.Title>{title}</PageHeader.Title>` does not fire — the AST check is JSX-tag positional, not flow-analysis).
- Excludes `app/api/**` (route handlers don't render h1).
- Excludes `app/**/_components/**` (private subcomponents may legitimately render an h1 if rendered into PageHeader.Title via composition).
- Excludes any usage of `<MyHeading as="h1" />` style polymorphic-element patterns (the AST rule matches `<h1>` literally, not custom components with `as` props).

### 3.4 Update `docs/RULES.md`

Add three entries with locked justification text:

- `headings-use-page-header` — "All authenticated admin pages must use the shared PageHeader component to ensure consistent typographic hierarchy and breadcrumb structure across the platform."
- `breadcrumb-required-when-page-header` — "Breadcrumbs are required because the platform's nested navigation depth (Admin > Sites > Site > Setup > Step) cannot be inferred from the URL alone."
- `no-raw-h1-in-pages` — "Raw h1 tags bypass the type scale defined in app/globals.css and create accessibility issues with multiple page-level h1s."

### 3.5 Update `docs/ARCHITECTURE.md`

- §13.3 — append paragraph documenting PageHeader / PageShell / Breadcrumb as canonical primitives, plus the type scale tokens (`.text-page-title`, `.text-section-title`, `.text-subsection`).
- §17 — add the three new audit rules to the in-flight workstreams list (or move to "shipped" depending on doc convention; check the existing pattern).
- §20 — append row: `Page chrome / breadcrumbs` → `components/ui/{page-header,breadcrumb,page-shell}.tsx`, `app/globals.css` (type scale).
- §2 — add the optimiser TODO from §2.1 of this spec.

### 3.6 Files touched in PR 3

- `scripts/audit.ts` (extend)
- `docs/RULES.md` (extend)
- `docs/ARCHITECTURE.md` (extend per §3.5)
- Any tests for `audit.ts` itself

---

## 4. Out of scope

- No customer-facing route work (`/customer/*` doesn't exist yet per ARCH §18)
- No optimiser route changes
- No `<PageNav>` secondary nav primitive
- No design tokens overhaul beyond the three new font-size classes
- No icon system change (Lucide stays at 20px floor)
- No mobile-first redesign — mobile responsive in §1.4 is minimum viable

---

## 5. PR ordering and merge gates

PR 1 → PR 2 → PR 3, in that order. Critically:

- **PR 3 must merge after PR 2.** The audit rules in PR 3 will fail on routes that haven't yet adopted PageHeader. Landing PR 3 before PR 2 completes would block PR 2.
- **PR 2 requires an admin-routes merge freeze.** PR 2 touches virtually every admin route, layout hierarchy, spacing structure, h1 semantics, and top-level actions. It will conflict with anything else touching admin routes during its review window. Before opening PR 2 for review: announce in `docs/WORK_IN_FLIGHT.md` that admin-route PRs from other workstreams should hold until PR 2 lands. Target window: 1–2 days from PR open to merge. Other PRs touching `lib/`, `app/api/`, optimiser, or non-admin frontend can continue.
- PR 1 and PR 2 can be in flight simultaneously (PR 2 development can begin against the PR 1 branch); PR 2 just can't merge until PR 1 does.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing page layouts break when PageHeader drops in | One-route-at-a-time during PR 2 development; visual diff on Vercel preview before each route's commit |
| Type scale change cascades onto existing card titles | New classes are additive (`.text-page-title` etc.). Existing card titles keep current classes until explicitly migrated. PR 2 migrates them. |
| Breadcrumb root mismatch creates dead links | §2.2 root rules locked; PR 3 audit rule enforces presence |
| Audit rule fires on unmigrated routes | PR ordering in §5 prevents this — PR 3 lands after PR 2 completes |
| Max-width disagreement breaks page layouts | §1.3 says audit existing widths first; pick dominant value |
| Mobile responsive breaks somewhere | Minimum viable per §1.4; not comprehensive |

---

## 7. Acceptance criteria

PR 1:
- [ ] `components/ui/page-header.tsx`, `breadcrumb.tsx`, `page-shell.tsx` exist
- [ ] Type scale tokens added to `app/globals.css`
- [ ] Vitest tests for breadcrumb and page-header pass
- [ ] PR description includes screenshots of primitives in isolation

PR 2:
- [ ] Every route in §2.1 imports and uses PageHeader
- [ ] Every breadcrumb starts with the correct root per §2.2
- [ ] Hand-rolled headers/breadcrumbs removed from page files
- [ ] Vercel preview screenshots in PR description for sites index, site detail, setup wizard, posts surface
- [ ] Playwright spec passes
- [ ] No regressions in existing known-passing tests

PR 3:
- [ ] Three new audit rules in `scripts/audit.ts`, all HIGH severity
- [ ] `docs/RULES.md` updated with locked justification text
- [ ] `docs/ARCHITECTURE.md` updated per §3.5
- [ ] `npm run audit:static` passes on main after merge
