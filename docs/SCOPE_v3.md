Opollo Site Builder — Build Scope v3
OPOLLO SITE BUILDER
Build Scope — v3 (Production Contract)
Final review. System prompt and tool schemas now defined as artifacts. Performance, preview accuracy, and versioning addressed.
What changed in v3
This version closes the remaining tightening items from Steven's second review. Two new standalone artifacts are produced alongside this scope — the system prompt template and the tool schemas — because these were the real gap. Describing what Claude should do is not the same as defining the contract it operates under.
Addition	What it prevents
SYSTEM_PROMPT_v1.md — full artifact	Inconsistent behaviour across sessions. Claude ignoring constraints in edge cases. 7 ordered sections with priority rules.
TOOL_SCHEMAS_v1.md — full artifact	Loose tool contracts. Every schema has strict input validation, defined failure modes, structured responses.
Generation-time validation rules in prompt	Fix loops from post-hoc validation. Claude generates valid output first time in 95%+ cases.
Async job queue for batch operations	Blocking UI during long batch runs. Chat remains responsive while pages generate in background.
Three-tier preview strategy	Preview lying about production. Live iframe + static HTML fallback + direct WP admin link.
Design system semantic versioning	Silent breakage of older pages when design system evolves. Every page tagged with DS version.
Executive summary
A Claude-powered web app that generates, previews, and publishes WordPress pages across multiple client sites through a single interface. Replaces copy-paste workflows and prevents visual drift across large site builds.
Proof of concept: LeadSource.co — a 40+ page product site. Once proven there, the same tool serves Opollo's client book.
Build time to working loop: one weekend. Build time to production-ready tool with all tightening in place: three to four weeks. The architecture is fully specified before build starts, eliminating mid-build rework.
The three deliverables for review
This scope document (build plan, timeline, decisions)
SYSTEM_PROMPT_v1.md (Claude's operating contract — 7 sections, priority-ordered)
TOOL_SCHEMAS_v1.md (Every tool definition with strict validation and structured responses)
Architecture at a glance
Layer	Role
Next.js web app (Vercel)	Chat UI, preview pane, site selector, session log, pending additions panel, batch queue UI
System prompt engine	Assembles 7-section prompt per session. Injects design system, brand voice, site context.
Tool layer (Next.js API routes)	Validates every tool call against schema before WordPress sees it. Strict input/output contracts.
Anthropic API (Claude Opus 4.7)	Streaming responses with tool use. Operates under the system prompt contract.
WordPress (native REST API)	Target environment. No custom plugin. Application Password auth per site.
Validation pipeline	Generation-time rules in prompt + API-layer enforcement. Two-layer defence against invalid output.
Job queue (background)	Batch generation runs async. Progress streamed to UI. Chat remains responsive.
Version registry	Tracks design system versions, pages pinned to versions, detects drift.
The contract — how Claude is constrained
Everything hinges on Claude operating under a strict contract. Loose prompts produce loose output. The full specification lives in SYSTEM_PROMPT_v1.md and TOOL_SCHEMAS_v1.md. Summary below.
Seven hard constraints (HC-1 through HC-7)
HC-1: Allowed components only — no invented classes, no freeform CSS
HC-2: Wrapper enforcement — every page body in scoped container with version tag
HC-3: No freeform HTML outside the system — every element matches a documented pattern
HC-4: Class naming discipline — scoped prefix, must exist in design system
HC-5: Destructive operations require confirmation — deletes, major rewrites, menu restructures
HC-6: Template lock compliance — batch pages match locked structure exactly
HC-7: Honest completion — no partial work, no substitution, no hidden failures
Generation-time validation rules
Injected into every system prompt. Claude validates against these WHILE generating, not after. This is the fix for validation loops.
Matching open/close tags before page ends
Only prefixed classes from design system
All link hrefs populated (no # placeholders)
All images have alt text
No script/style/iframe except documented components
Heading hierarchy correct (one h1, no skipped levels)
Wrapper div outermost with correct data-ds-version
Meta description 50-160 chars, slug kebab-case
No placeholder text, no Claude disclaimers
Word counts within documented ranges per template
API-layer validation (second defence)
Every tool call passes through pre-WordPress validation. Failures return specific actionable errors back to Claude so it can self-correct.
Schema validation (types, patterns, required fields)
Design system version match check
Wrapper container verification
Class scope verification against design system
Forbidden pattern check
Structural check against template type
HTML validity
Slug uniqueness
Content sanity
Performance and latency
Naively built, batch operations would be painful. 40 pages × (stream + tool call + WP API + preview reload) = 20-minute blocking operations. The architecture handles this with proper async.
Async job queue
Long-running operations (batch generation, bulk menu changes, multi-page updates) run as background jobs.
Chat remains responsive during job execution
Progress streamed via server-sent events to the UI
Individual page failures don't block the batch — they surface to review queue
Jobs persist across page refreshes (stored in Postgres once on Supabase; local queue for v1)
Cancel button on any running job; partial work preserved as drafts
Preview caching
Preview iframe reloads are slow if naive. Optimisations:
Static HTML render of the last known good state cached locally
Preview pane shows cached state during regeneration, updates when draft saved
Debounced preview reload — rapid edits don't trigger cascading iframe loads
Skeleton UI during long WP renders rather than blank iframe
Claude API latency
Streaming responses start rendering tokens immediately. Tool call latency is the real cost — each WP API round trip is 200-800ms typically. Mitigations:
Parallel tool calls where independent (e.g. multiple media uploads)
Prefetch site context at session start so first message is fast
Cache design system + brand voice in memory — not refetched per message
Expected end-to-end timings
Operation	Expected time
Single page generation (simple)	15-30 seconds
Single page generation (complex)	45-90 seconds
Page iteration (surgical update)	10-20 seconds
Batch of 5 pages (async)	3-5 minutes background, UI stays responsive
Menu change (direct)	2-5 seconds
Menu change (proposed, then executed)	5-10 seconds plus user approval
Session start (full context load)	3-8 seconds, once per session
Preview accuracy — three-tier strategy
Iframe preview can lie about production. WordPress caching, theme conflicts, auth issues, or server-side rendering quirks can all cause preview-vs-live mismatches. The fix is layered fallbacks so you always have a reliable view.
Tier 1 — Live iframe preview (default)
Points at WordPress draft URL with preview token
Renders exactly as production would render it
Auto-refreshes when drafts update
Skeleton UI while loading
Tier 2 — Static HTML preview (fallback)
Renders the generated HTML in a sandboxed iframe with design system CSS only
Used when live preview fails or is slow
Shows Claude's output as-generated, before WP theme wrapping
Useful for debugging theme-vs-content issues
Toggle button in preview pane — one click between tiers
Tier 3 — Direct WordPress admin link
Always visible in the preview toolbar
Opens page in WP admin for editing, publishing, or troubleshooting
Ultimate fallback if both preview methods fail
Also useful when you want to see raw post meta, revisions, or comments
Additional preview features
Viewport switcher — 320px / 768px / 1024px / 1440px to check mobile rendering
Theme switcher — render the same content under different WP themes if testing compatibility
"Open in new tab" for full-screen preview
Cache bust button if WordPress caching is suspected
Design system versioning
Critical missing piece from v2. Without versioning, editing the design system silently changes every page that depends on it. Pages built last month could break when you tweak the design system today.
Semantic versioning
Every design system file tagged with semver (MAJOR.MINOR.PATCH):
PATCH (1.0.1) — bug fixes, typo corrections, no structural changes. Pages auto-compatible.
MINOR (1.1.0) — new components added, existing components unchanged. Pages auto-compatible.
MAJOR (2.0.0) — breaking changes to existing components. Pages need re-review.
Page version pinning
Every generated page has `data-ds-version="1.2.0"` embedded in its wrapper (enforced by HC-2). This is the audit trail.
Drift detection
The app continuously monitors for version drift:
Pages built on older PATCH/MINOR versions flagged green — compatible, no action needed
Pages built on older MAJOR versions flagged yellow — may need re-review
Visual indicator per page in the site list
Bulk "rebuild to current version" option when a MAJOR bump happens
Diff view — see what changed between two DS versions
Change management workflow
Proposed design system change enters the pending additions panel
Reviewed and classified as patch / minor / major
On approval, DS version bumped, change log entry created
If major, affected pages identified and user notified
User can approve auto-rebuild, manual review page-by-page, or defer
Old DS versions archived, never deleted — always possible to see what page X was built against
Practical impact
For LeadSource specifically: the design system will evolve as pages reveal edge cases. Version 1.0.0 at launch becomes 1.3.0 by month end as new components get added. Every page knows what version it was built against; drift is visible; nothing breaks silently.
LeadSource execution plan
Week 1 — Foundation
Phase 1 app build (chat, preview, core tools, auth, error handling, logging) — weekend 1
Parallel: full-day LeadSource design system session with review gate and theme testing
End of week: working app connected to LeadSource WP, design system v1.0.0 locked
Week 2 — Phase 2 features
Day 1-2: Content validation pipeline, menu proposal flow, pending additions UI
Day 3: Generate LeadSource homepage, iterate to perfection, treat as DS real-world test
Day 4-5: First integration page (Gravity Forms), approve, lock batch template
Day 6-7: Batch remaining WP integration pages, batch standalone form tool pages
Week 3 — Scale and polish
Day 1-2: Multi-tenant dropdown, second tenant added (Opollo own site)
Day 3: Batch problem-led pages
Day 4: Batch troubleshooting pages with locked template
Day 5: Use-case pages and SEO landing pages
Day 6-7: Menu structure, version 1.0 DS locked, final review, LeadSource launch
Week 4 — Optional hardening
Replace Basic Auth with proper team auth if rolling out to Gemma/Caleb
Supabase migration for persistent state
First Opollo client site build as second real-world test
Decisions needed from Steven (final)
1. Who builds the app?
A — Steven builds with Claude Code over weekend (fastest, requires focused weekend)
B — Contract to a Next.js developer (1-2 weeks, costs, more polished)
C — Hybrid: Steven builds v1, contract the polish
2. LeadSource first, or Opollo first?
A — LeadSource first (recommended — clean slate, no client politics, proves the tool)
B — Opollo own site first
C — Generic build, point at whichever ready
3. LeadSource design system tier?
A — Standard client process (1 day, full review gate)
B — Premium bespoke (1.5-2 days, Caleb reviews after Claude first pass) — recommended for flagship
C — Template-tier (not recommended for flagship product)
4. Themes to test design system against?
A — Twenty Twenty-Four, Hello Elementor, Astra (broad coverage)
B — Just Hello Elementor (fastest, Opollo standard stack)
C — Custom list based on actual clients
5. NEW — Sign-off on the contract artifacts
A — SYSTEM_PROMPT_v1.md as-is, start the build
B — Review SYSTEM_PROMPT_v1.md and TOOL_SCHEMAS_v1.md first, iterate if needed
C — Send both artifacts for external review before committing
Recommended next steps
Review v3 scope + SYSTEM_PROMPT_v1.md + TOOL_SCHEMAS_v1.md
Confirm the five decisions
Kick off LeadSource design system session (can happen in parallel with app build)
Start Phase 1 app build — weekend one
LeadSource.co live within three to four weeks from green-light
Page
