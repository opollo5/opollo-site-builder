# Navigation architecture (two-level rail + section panel)

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Navigation architecture".
> CLAUDE.md keeps no navigation content; this file is the canonical reference.

Two-level persistent navigation, Semrush-shaped:

- **Primary rail (`components/nav/primary-nav.tsx`, 70px wide):** always
  visible. Round Opollo icon at top, icon + short label per item, ⌘K +
  Sign out pinned at the bottom rail. Active item uses `bg-nav-active`
  only — no border, no green text, no accent bar.
- **Section panel (`components/nav/section-nav.tsx`, 220px wide):**
  conditionally visible — only when the active primary item carries a
  `sectionNav` config in `nav-config.ts`. Title at top, optional
  `CompanySelector` below the title (Social section, Opollo staff only),
  group headers in muted uppercase, items in `text-sm`. Active item uses
  `bg-nav-active` + `font-medium` only.
- **Mobile:** hamburger top-bar opens an off-canvas drawer that lists
  primary items as an accordion (section nav items expand inline).

## Rules — never violate

- All nav config lives in `components/nav/nav-config.ts` — single
  source of truth for primary items + section nav structure + filter
  predicates (`requiresAdminTier`, `requiresSuperAdmin`,
  `requiresCompanyAdmin`).
- Don't render nav chrome from `page.tsx` files or child layouts. The
  shell wraps everything; pages render content only.
- Don't truncate primary-rail labels. If a label doesn't fit, shorten
  the word (e.g. "Companies" → "Clients" if needed).
- Don't add bottom-rail items beyond ⌘K and Sign out. Account surfaces
  go behind the avatar/dropdown or under the Admin section nav.
- Don't use the wordmark logo in the rail. The round
  `/images/opollo-icon.png` icon is the only logo here.

## Icon system — Linearicons web font

All icons across the entire app use the Linearicons icon font wrapped
by `<NavIcon>`. See `docs/patterns/icons.md` for the full intent map +
sizing convention. Never import from `lucide-react` (the package was
removed in the two-level-nav workstream).

```tsx
import { NavIcon } from "@/components/ui/nav-icon";

<NavIcon name="calendar-full" size={16} />
```

Font files live at `public/fonts/linearicons/` (copied from
`assets/Linearicons/fonts/`); the CSS class definitions are at
`public/fonts/linearicons/linearicons.css` and loaded via a `<link>`
tag in `app/layout.tsx`. The woff is preloaded so icon glyphs don't
flash blank on first paint.

## Adding a new top-level section

1. Add an entry to `primaryNavItems` in `components/nav/nav-config.ts`.
2. If the section has sub-items, populate `sectionNav` with one or more
   groups; each group has an optional uppercase `label` and an array
   of `SectionNavItem`s.
3. Pages under the section render content only — no nav chrome.
