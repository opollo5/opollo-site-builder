# M12 + M13 Context Anchor

## Purpose
Every session working on M12 or M13 reads this file first. Decisions are locked here, not in chat history.

## M12 — Brief-driven sequential page generation
- Status: parent plan merged (PR #98), sub-slices M12-1 through M12-6 not yet built
- Mission: operator uploads document → parser extracts ordered per-page list → sequential runner generates one page at a time → pause between pages → publish via M7
- Data model (locked):
  - `briefs` (brand_voice, design_direction, review_mode, version_lock)
  - `brief_pages` (ordinal, mode: full_text|short_brief, template_id nullable, body immutable post-generation)
  - `brief_runs` (current_ordinal for crash recovery)
  - `site_conventions` (structured: header_html, footer_html, nav_pattern, cta_pattern, rhythm_rules_json — NOT freeform JSONB)
- Engine commitments (locked):
  - Pages generated one at a time (sequential, not parallel)
  - Multi-pass per page: draft → self-critique → revise
  - Visual review pass: Playwright screenshot → Claude critique → revise
  - Whole document as context for every page
  - DS-only generation as default (template_id nullable)
  - First-page anchor: 2–3 extra revision cycles
  - Pause-mode-only for launch

## M13 — Blog post generation (extends M12)
- Status: pattern file shipped (PR #1: docs/patterns/assistive-operator-flow.md), parent plan not yet written
- Core insight: M12 and M13 are the same engine running two different missions. M13 extends M12, does not parallel it.
- Shared primitives (M12 owns, M13 reuses verbatim):
  - `lib/brief-runner.ts` — M13-3 extends with mode parameter, does not fork
  - `lib/brief-parser.ts` — reused for post briefs
  - `site_conventions` struct — inherited verbatim by posts on same site
  - Visual review pass — applied to post templates under Kadence
  - Review checkpoint UI — same pattern
  - Running content_summary — posts get cross-post continuity
- M13 net-new surface:
  - `posts` table (separate from `pages`)
  - `content_type: "page" | "post"` axis
  - WordPress REST for posts (/wp/v2/posts + taxonomies + featured media)
  - `lib/site-preflight.ts` (capability check via /wp-json/wp/v2/users/me)
  - `lib/seo-plugin-detection.ts` (Yoast/RankMath/SEOPress/none)
  - `lib/error-translations.ts` (WP error → operator-friendly message table)
  - Kadence install automation + DS tokens → Kadence globals via REST
  - One-screen "Appearance" panel in Opollo admin
  - `/admin/sites/[id]/posts` admin surface
- Locked decisions:
  - Kadence = Option C (default theme, operator never sees Customizer)
  - Kadence free tier at launch
  - First-page anchor does NOT apply to posts (site already anchored) — M13-3 disables anchor cycles when content_type = "post"
  - Pause-mode-only (no auto-publish)

## Sub-slice plan
M12 (parent plan merged, sub-slices not built):
- M12-1 schema + upload + parser + operator commit
- M12-2 brand voice + site_conventions schema + anchor spec
- M12-3 sequential runner (multi-pass, whole-doc context) — M13-3 depends on this
- M12-4 visual review pass
- M12-5 review-between-pages UI
- M12-6 E2E + docs + PDF/.docx stretch

M13 (not started):
- M13-1 posts table + content_type axis + lib/posts.ts + migration 0013 — orthogonal to M12, safe to build now
- M13-2 WP REST for posts + preflight + SEO plugin detection + error translations — orthogonal to M12, safe to build now
- *** HARD PAUSE: M13-3 blocks on M12-3 merging ***
- M13-3 extend lib/brief-runner.ts for single-page blog mode (add mode parameter, do not fork)
- M13-4 /admin/sites/[id]/posts admin surface
- M13-5 Kadence install + Appearance panel
- M13-6 E2E + RUNBOOK

## Strategy
Option B — parallel on orthogonal slices, hard pause before runner extension. M13-1 and M13-2 ship now. M13-3 onwards waits for M12-3.

## Execution rules (all sessions)
- One PR at a time, auto-merge armed, fix forward in same PR on CI failure
- Claude Code opens PRs but never merges
- M13 must not modify M12 primitives (brief-runner, site_conventions, visual-review, review-checkpoint) — coordinate via docs/WORK_IN_FLIGHT.md
- Assistive-operator-flow pattern applies to every user-facing surface (preflight blockers, in-flow confirmations, translated errors, confirm-before-destructive)
- Scope questions mid-PR → stop and ask, do not expand silently

## How to resume after a dead session
1. `cat docs/CONTEXT.md` (this file)
2. `cat docs/WORK_IN_FLIGHT.md`
3. `gh pr list --state open` — find the last in-flight PR
4. Decide: continue the in-flight PR, or start the next one in sequence
5. Never re-derive scope from chat — scope lives here
