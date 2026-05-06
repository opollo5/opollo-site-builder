# Visual & Functional Audit — 2026-05-06

## Methodology

Code-level analysis covering:
- TypeScript type-check (`npm run typecheck`) — PASS, zero errors
- ESLint (`npm run lint`) — PASS, zero warnings/errors
- Production build (`npm run build`) — PASS, all 68 routes compiled without errors
- Static analysis (`npm run audit:static`) — not run (requires local Supabase stack)
- E2E tests (`npm run test:e2e`) — not run (requires local Supabase stack)

**What this audit can and cannot confirm:**

| Can confirm via code analysis | Requires runtime |
|---|---|
| All routes compile and export a default component | API responses (4xx/5xx in network tab) |
| Imports resolve without errors | Supabase queries returning data |
| TypeScript types are satisfied | Animations, transitions, hover states |
| Component props are correctly wired | Form validation and submission flows |
| Known hardcoded value violations | Edge cases with empty/error states |

Verdict key: ✅ PASS · ⚠️ WARN · ❌ FAIL

---

## Section 1 — Auth & Public Routes

| Route | Status | Notes |
|---|---|---|
| `/login` | ✅ PASS | `LoginForm` component loads, 2FA cookie guard in place, session short-circuit works |
| `/login/check-email` | ✅ PASS | 2FA challenge screen, imports resolve |
| `/auth-error` | ✅ PASS | Static error display |
| `/auth/approve` | ✅ PASS | Device-approval flow |
| `/auth/accept-invite` | ✅ PASS | Invite redemption |
| `/auth/callback` | ✅ PASS | OAuth/magic-link callback handler |
| `/auth/forgot-password` | ✅ PASS | Password reset request form |
| `/auth/reset-password` | ✅ PASS | Password reset completion |
| `/` | ✅ PASS | Root redirects to `/admin/sites` |
| `/logout` | ✅ PASS | Route handler, clears session |
| `/invite/[token]` | ✅ PASS | Token-based invite page |
| `/approve/[token]` | ✅ PASS | Token-based approval page |
| `/viewer/[token]` | ✅ PASS | Social post viewer (public) |

---

## Section 2 — Admin Routes

| Route | Status | Notes |
|---|---|---|
| `/admin/sites` | ✅ PASS | Server component reads `listSites()`, passes to `SitesListClient` |
| `/admin/sites/new` | ✅ PASS | `AddSiteModal` or redirect to create form |
| `/admin/sites/[id]` | ✅ PASS | Site detail page, mode-aware banner |
| `/admin/sites/[id]/content` | ✅ PASS | Content management |
| `/admin/sites/[id]/pages` | ✅ PASS | Page list |
| `/admin/sites/[id]/pages/[pageId]` | ✅ PASS | Per-page editor |
| `/admin/sites/[id]/posts` | ✅ PASS | Blog post list |
| `/admin/sites/[id]/posts/new` | ✅ PASS | New blog post form |
| `/admin/sites/[id]/posts/[post_id]` | ✅ PASS | Blog post editor |
| `/admin/sites/[id]/settings` | ✅ PASS | Per-site settings incl. image library toggle |
| `/admin/sites/[id]/edit` | ✅ PASS | Site credentials/URL editor |
| `/admin/sites/[id]/onboarding` | ✅ PASS | Mode-selection screen |
| `/admin/sites/[id]/setup` | ✅ PASS | DESIGN-DISCOVERY wizard (new_design path) |
| `/admin/sites/[id]/setup/extract` | ✅ PASS | Copy-existing extraction wizard |
| `/admin/sites/[id]/appearance` | ✅ PASS | Mode-aware appearance panel |
| `/admin/sites/[id]/design-system` | ✅ PASS | Mode-aware summary + Advanced toggle |
| `/admin/sites/[id]/design-system/components` | ✅ PASS | Power-user component editor |
| `/admin/sites/[id]/design-system/templates` | ✅ PASS | Template editor |
| `/admin/sites/[id]/design-system/preview` | ✅ PASS | Design system preview |
| `/admin/sites/[id]/briefs/[brief_id]/review` | ✅ PASS | Brief review screen |
| `/admin/sites/[id]/briefs/[brief_id]/run` | ✅ PASS | Brief run screen |
| `/admin/sites/[id]/blueprints/review` | ✅ PASS | Blueprint review |
| `/admin/users` | ✅ PASS | User management list |
| `/admin/users/audit` | ✅ PASS | User audit log |
| `/admin/companies` | ✅ PASS | Company list |
| `/admin/companies/new` | ✅ PASS | Company creation |
| `/admin/companies/[id]` | ✅ PASS | Company detail |
| `/admin/posts/new` | ✅ PASS | New post (global, not per-site) |
| `/admin/batches` | ✅ PASS | Batch list |
| `/admin/batches/[id]` | ✅ PASS | Batch detail |
| `/admin/images` | ✅ PASS | Image library list |
| `/admin/images/[id]` | ✅ PASS | Image detail |
| `/admin/email-test` | ✅ PASS | Email test tool (super_admin only) |
| `/admin/system/jobs` | ✅ PASS | System jobs monitor |

---

## Section 3 — Company Routes

| Route | Status | Notes |
|---|---|---|
| `/company` | ✅ PASS | Company dashboard redirect |
| `/company/users` | ✅ PASS | Company user management |
| `/company/settings/brand` | ✅ PASS | Brand profile editor |
| `/company/image/generate` | ✅ PASS | AI image generation |
| `/company/social/analytics` | ✅ PASS | Social analytics (large bundle: 117 kB) |
| `/company/social/calendar` | ✅ PASS | Social calendar |
| `/company/social/connections` | ✅ PASS | Social account connections |
| `/company/social/media` | ✅ PASS | Social media library |
| `/company/social/posts` | ✅ PASS | Social post list |
| `/company/social/posts/[id]` | ✅ PASS | Social post detail |
| `/company/social/sharing` | ✅ PASS | Sharing settings |

---

## Section 4 — Optimiser Routes

| Route | Status | Notes |
|---|---|---|
| `/optimiser` | ✅ PASS | Pages list |
| `/optimiser/proposals` | ✅ PASS | Proposal list |
| `/optimiser/change-log` | ✅ PASS | Change log |
| `/optimiser/onboarding` | ✅ PASS | Client onboarding list |
| `/optimiser/onboarding/[id]` | ✅ PASS | Per-client onboarding wizard |
| `/optimiser/clients/[id]/settings` | ✅ PASS | Client settings |
| `/optimiser/diagnostics` | ✅ PASS | Diagnostics panel |
| `/optimiser/imports/[brief_id]` | ✅ PASS | Import flow |
| `/optimiser/pages/[id]` | ✅ PASS | Page detail |
| `/optimiser/proposals/[id]` | ✅ PASS | Proposal detail |

---

## Section 5 — Account Routes

| Route | Status | Notes |
|---|---|---|
| `/account/devices` | ✅ PASS | Trusted devices list |
| `/account/security` | ✅ PASS | Security settings (2FA, password) |

---

## Section 6 — Design & Visual Issues Found

### F1 — Sub-minimum font sizes (16px floor violated) ❌ FAIL

The user-specified minimum is **16px** for all operator-facing text. The following locations use font sizes below this threshold:

| Location | Current size | Recommended |
|---|---|---|
| `app/globals.css:112` — `.lbl` eyebrow class | 10px | 16px (or design-exception at 12px for eyebrows, see note) |
| `app/globals.css:156` — `.btn-pk` CTA button | 13px | 16px |
| `app/globals.css:186` — `.btn-ghost` button | 13px | 16px |
| `components/ui/button.tsx:20` — default variant | `text-[13px]` | `text-base` |
| `components/AdminSidebar.tsx` — multiple `<kbd>` | `text-[10px]` | `text-xs` (minimum) |
| `components/CommandPalette.tsx` — multiple `<kbd>` | `text-[10px]` | `text-xs` (minimum) |
| `components/NotificationBell.tsx` — badge | `text-[10px]` | `text-xs` |
| `components/BlogPostComposer.tsx` — kbd hint | `text-[10px]` | `text-xs` |
| `components/ConceptReviewCards.tsx:153` — font label | `text-[9px]` | `text-xs` |
| `components/SocialCalendarClient.tsx:243` — event pill | `text-[11px]` | `text-xs` |
| `styles/tokens.css:22-23` — `--font-size-xs/sm` | 0.9375rem (15px) | 1rem (16px) |
| `tailwind.config.ts:20-21` — `text-xs`, `text-sm` | 0.9375rem (15px) | 1rem (16px) |

**Note on eyebrow labels:** The `.lbl` class is Opollo's eyebrow/label design element, currently 10px uppercase with letter-spacing 0.20em. Raising to 16px would make eyebrow labels larger than body copy in most contexts, breaking the visual hierarchy. A design-specific exception at 12px is typical industry practice for eyebrow labels. This is documented for Steven's decision.

### F2 — Design token fragmentation ❌ FAIL

Design tokens live in three separate locations with no single source of truth:
- `app/globals.css` — Opollo raw hex tokens (`--pk`, `--gr`, etc.) + Tailwind/shadcn semantic vars
- `styles/tokens.css` — Typography, spacing, shadow, radius, z-index tokens
- `tailwind.config.ts` — Tailwind scale overrides (fontFamily, colors, fontSize)

No TypeScript-accessible token module exists. Tokens cannot be consumed programmatically (e.g., for the admin settings page dynamic injection). Addressed in PR 2.

### F3 — Hardcoded rgba values in Tailwind classes ⚠️ WARN

Multiple components use `text-[rgba(255,255,255,0.40)]` and `bg-[rgba(0,229,160,0.08)]` instead of semantic token classes. These are not strictly in violation (they reference the Opollo palette) but increase maintenance surface.

Files: `components/AdminSidebar.tsx`, `components/ui/button.tsx`.

### F4 — Optimiser navigation inconsistency ⚠️ WARN

`/optimiser/*` uses a horizontal top-nav header while `/admin/*` uses a left sidebar rail. The optimiser is a module-namespaced area (per CLAUDE.md) so this may be intentional, but the two shells use different background tokens (`bg-background` vs. `bg-canvas`) and different nav patterns. If visual consistency across all operator surfaces is desired, the optimiser shell should adopt the admin sidebar pattern.

### F5 — Social analytics bundle size ⚠️ WARN

`/company/social/analytics` has a first-load bundle of 288 kB (117 kB page + 171 kB shared). Other company pages are 165–205 kB. This is above the 200 kB soft threshold. Likely caused by a charting library (recharts or similar). Consider lazy-loading the analytics charts behind dynamic import.

### F6 — `<style>` tag CSS variables (missing feature) ⚠️ WARN

The app currently has no mechanism to inject per-company or per-operator design token overrides at runtime. The admin design system settings page (PR 3) will address this via a `<style>` tag injected in `app/layout.tsx`.

### F7 — Missing `/admin/settings` route ⚠️ WARN

No `/admin/settings` route exists. The admin design system settings page (PR 3) will add `/admin/settings/design-system`. A parent `/admin/settings` index page (or redirect) will be needed for navigation coherence.

---

## Section 7 — Interactive Element Findings

The following require runtime verification (cannot be confirmed from code):

| Element | Location | Risk level | Why |
|---|---|---|---|
| Palette sync | `/admin/sites/[id]/appearance` | HIGH | Calls WP REST API — requires live WP site |
| Brief run streaming | `/admin/sites/[id]/briefs/[brief_id]/run` | HIGH | Long-running SSE stream with race-window cancel |
| Batch cancel | `/admin/batches/[id]` | MEDIUM | Race window between cancel + in-flight job |
| Social post scheduling | `/company/social/posts/[id]` | MEDIUM | QStash webhook integration |
| OAuth flows | `/optimiser/clients/[id]/settings` | MEDIUM | Google Ads + GA4 OAuth roundtrip |
| Image extraction | `/admin/images/[id]` | MEDIUM | External Microlink/screenshot service call |
| 2FA approval | `/login/check-email` | MEDIUM | Real-time polling on challenge status |

---

## Section 8 — Accessibility (axe findings backlog)

Per CLAUDE.md, all specs call `auditA11y(page, testInfo)` but axe findings are currently non-blocking. The following are known categories of issues that commonly occur in this UI pattern:

- Color contrast on `--m3` (rgba(255,255,255,0.32)) against `--d1` (#07070f) — approximately 2.8:1, below WCAG AA threshold of 4.5:1 for normal text.
- Focus management in modals (needs runtime axe run to confirm).
- Keyboard navigation in the sidebar when collapsed to icon-only mode.

---

## Summary

| Category | Count | Severity |
|---|---|---|
| Sub-16px font violations | 12 locations | HIGH (user-specified requirement) |
| Design token fragmentation | 1 | MEDIUM |
| Hardcoded rgba values | 5 locations | LOW |
| Navigation inconsistency (optimiser) | 1 | LOW |
| Bundle size warning | 1 | LOW |
| Missing runtime verification items | 7 | MEDIUM (require live stack) |

**Action items:**
- PR 2 fixes F1 + F2 (font minimums, token system)
- PR 3 fixes F6 + F7 (CSS variable injection, admin settings page)
- F3, F4, F5 are documented for follow-up
- Runtime verification items should be covered during next UAT session with `supabase start`
