# M12 + M13 Context Anchor

Every session working on M12 or M13 reads this file first. Decisions are locked here.

## M12 — Brief-driven sequential page generation
Status: parent plan merged (PR #98). Sub-slices M12-1 through M12-6 not built.
Mission: operator uploads document → parser extracts per-page list → sequential runner generates one page at a time → pause between pages → publish via M7.

Data model (locked):
- briefs (brand_voice, design_direction, review_mode, version_lock)
- brief_pages (ordinal, mode: full_text|short_brief, template_id nullable, body immutable post-generation)
- brief_runs (current_ordinal for crash recovery)
- site_conventions (structured: header_html, footer_html, nav_pattern, cta_pattern, rhythm_rules_json)

Engine commitments (locked):
- Pages generated one at a time (sequential)
- Multi-pass per page: draft → self-critique → revise
- Visual review pass: Playwright screenshot → Claude critique → revise
- Whole document as context for every page
- DS-only generation default (template_id nullable)
- First-page anchor: 2-3 extra revision cycles
- Pause-mode-only for launch

## M13 — Blog post generation (extends M12)
Status: pattern file shipped (PR #1). Parent plan not written.
Core insight: M12 and M13 are the same engine, different missions. M13 extends M12.

Shared primitives (M12 owns, M13 reuses):
- lib/brief-runner.ts — M13-3 extends with mode parameter, does not fork
- lib/brief-parser.ts — reused for post briefs
- site_conventions struct — inherited verbatim
- Visual review pass — applied to post templates
- Review checkpoint UI — same pattern
- Running content_summary — cross-post continuity

M13 net-new:
- posts table
- content_type: "page" | "post" axis
- WordPress REST for posts
- lib/site-preflight.ts (capability check)
- lib/error-translations.ts
- Kadence install + DS → globals mapping
- Appearance panel in admin
- /admin/sites/[id]/posts surface

Locked decisions:
- Kadence default theme, operator never sees Customizer
- Kadence free tier at launch
- First-page anchor disabled when content_type = "post"
- Pause-mode-only (no auto-publish)

## Sub-slice plan

M12 (parent plan merged, sub-slices not built):
- M12-1 schema + upload + parser + operator commit
- M12-2 brand voice + site_conventions schema + anchor spec
- M12-3 sequential runner — M13-3 depends on this
- M12-4 visual review pass
- M12-5 review-between-pages UI
- M12-6 E2E + docs + PDF/.docx stretch

M13:
- M13-1 posts table + content_type axis + lib/posts.ts + migration 0013 — build now
- M13-2 WP REST + preflight + SEO detection + error translations — build now
- HARD PAUSE: M13-3 blocks on M12-3
- M13-3 extend runner with mode parameter
- M13-4 /admin/sites/[id]/posts surface
- M13-5 Kadence install + Appearance panel
- M13-6 E2E + RUNBOOK

## Execution rules
- M13 must not modify M12 primitives without coordinating via docs/WORK_IN_FLIGHT.md
- Assistive-operator-flow pattern applies to every user-facing surface
- Scope questions mid-build → stop and ask
