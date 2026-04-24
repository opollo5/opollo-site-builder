# M13 — Blog Post Generation (extends M12)

## What it is

A blog-post counterpart to M12's page generator. The operator uploads a post brief (Markdown today; PDF/.docx stretch inherited from M12-6) — one brief can describe one post or a small batch of posts. The same structural parser M12 uses extracts an ordered per-post list; the operator reviews and commits the parse; the sequential runner walks the list: draft → self-critique → revise → visual-review → revise, pausing after each post for approval. Posts publish through the WordPress REST `posts` endpoint rather than M7's page-publish path, which means a new WP capability matrix (featured media, categories/tags, SEO-plugin awareness), a new preflight surface, and a translated-error table for the REST failures an operator actually sees. Kadence is Opollo's default theme: M13 installs it at site-registration time and maps the site's design-system tokens to Kadence globals via REST so an operator never has to touch the Customizer.

The headline decision is that **M13 extends the M12 engine rather than forking it**. `lib/brief-runner.ts` grows a `mode: 'page' | 'post'` parameter; everything else — the parser, the `site_conventions` struct, the visual-review pass, the per-page review checkpoint UI — is reused verbatim. Posts inherit the site's committed `site_conventions` from M12 (same typographic rhythm, same tone register, same CTA phrasing) so a site generated through M12 and then extended with blog posts through M13 reads as one brand voice, not two.

## Why a separate milestone

Reusing the engine is not the same as reusing the surface. Blog posts have WP-side machinery that pages don't: taxonomies, featured images, scheduled publish, SEO-plugin meta (Yoast / RankMath / SEOPress), and a different REST namespace whose failure modes translate differently for operators ("your login can edit posts but not upload media" is a distinct blocker from "your login can't edit posts at all"). Bundling these into M12 would have doubled the review checkpoint UI's concept count and forced the parent plan to thread two content types through every sub-slice. The cleaner split is: M12 locks the engine and the page-publish path; M13 adds the content_type axis, the WP posts integration, the preflight + translation machinery, the post admin surface, and the Kadence install.

M13 is also the first milestone to ship `assistive-operator-flow` (docs/patterns/assistive-operator-flow.md) end-to-end on a user-facing surface. Every blocker surfaces as a preflight check before commit; every WP REST error goes through `lib/error-translations.ts` before hitting the UI; every destructive action (unpublish, re-sync globals, theme replace) goes through a confirm modal that names the exact consequence. The pattern exists to make operator-facing surfaces legible at 2am; M13 is where it becomes load-bearing.

## Dependency on M12

M13-3 is a hard block on M12-3. The runner's `mode` parameter has no meaning until `lib/brief-runner.ts` exists as a single sequential runner — forking a runner-for-posts and keeping it in sync with a runner-for-pages is the exact failure mode this milestone's structure exists to prevent. M13-1 and M13-2 are orthogonal to M12 (a schema migration and a WP REST wrapper + preflight library) and can ship in parallel with M12-1/M12-2. M13-3 onwards is strictly serial after M12-3 lands on `main`. See `docs/CONTEXT.md` §Sub-slice plan for the sequencing.

## Shared-primitives map

| Primitive | Owner | M13 usage |
| --- | --- | --- |
| `lib/brief-runner.ts` | M12-3 | M13-3 adds a `mode` parameter. Never forked. |
| `lib/brief-parser.ts` | M12-1 | Reused for post briefs. Per-post `mode` field matches per-page. |
| `site_conventions` struct | M12-2 | Inherited verbatim per site. No post-specific conventions. |
| Visual review pass | M12-4 | Applied to rendered post templates (Kadence post layout). |
| Review checkpoint UI pattern | M12-5 | Reused on `/admin/sites/[id]/posts/[postId]/run`. |
| Running `content_summary` | M12-3 | Posts append summaries for cross-post continuity within a brief. |

Anything in this table that changes name, path, or signature is a breaking change for M13. See "Downstream dependencies (M13)" in `docs/plans/m12-parent.md` for the contract.

## Scope (shipped in M13)

- **M13-1 — posts table + content_type axis + `lib/posts.ts` + migration 0013.** New `posts` table mirrors `pages` for the generative columns (`content_brief`, `content_structured`, `generated_html`, `design_system_version`) and adds blog-specific fields (`excerpt`, `published_at`, `author_id`). `content_type` column CHECK-constrained to `'post'` gives the runner a row-level assertion key; the axis is legible without a join. `wp_post_id` is nullable (drafts live in Opollo before WP assigns an id) and the partial UNIQUE `(site_id, wp_post_id) WHERE wp_post_id IS NOT NULL` treats NULL as distinct so many drafts coexist. Soft-delete + audit columns + `version_lock` per `docs/DATA_CONVENTIONS.md`. `lib/posts.ts` exposes `listPostsForSite` / `getPost` / `createPost` / `updatePostMetadata` on the same shape as `lib/pages.ts`.
- **M13-2 — WP REST posts + preflight + SEO plugin detection + error translations.** `lib/wp-posts.ts` wraps `/wp/v2/posts` publish / update / unpublish; helpers for taxonomies (`/wp/v2/categories`, `/wp/v2/tags`) and featured-media upload (`/wp/v2/media`). `lib/site-preflight.ts` hits `/wp-json/wp/v2/users/me` to verify the stored app password has `edit_posts` + `upload_files`; probes `/wp-json/` to confirm REST is enabled. `lib/seo-plugin-detection.ts` fingerprints Yoast / RankMath / SEOPress from `/wp-json/` namespace listing and returns a typed result the UI can key off. `lib/error-translations.ts` maps common WP REST failures (401, 403, 404, 500, `rest_post_invalid_id`, `rest_invalid_param`, `rest_forbidden`, `upload_dir_error`) to operator-friendly strings.
- **M13-3 — extend brief-runner with `mode` parameter + post quality gates + anchor disabled for posts.** `lib/brief-runner.ts` gains `mode: 'page' | 'post'`; a dispatch table chooses per-mode helpers (anchor cycles, WP target, content_type assertion). Post mode disables the first-page anchor cycles entirely — the site is already anchored by M12's run, so posts run the standard multi-pass without the 2-3 extra revisions. Post-specific quality gates: excerpt length cap, featured-image presence check when the site's SEO plugin requires one, category/tag whitelist if the brief declared taxonomies. Budget reservation reuses M8's `reserveBudget`.
- **M13-4 — `/admin/sites/[id]/posts` admin surface.** List (filter by status + `q` over title/slug, paged, `deleted_at IS NULL` by default), detail (draft / published preview + critique log + screenshot + operator actions: approve, revise-with-note, cancel, publish, unpublish), and a publish-confirm modal that names the exact WP url and destructive consequence. `/admin/sites/[id]/posts/[postId]/run` reuses M12-5's review-checkpoint pattern verbatim. Axe `auditA11y()` on every visited page per the CLAUDE.md E2E contract.
- **M13-5 — Kadence palette sync + Appearance panel.** Operator installs Kadence manually once per site through WP Admin → Appearance → Themes. Opollo detects the active theme via the read-only `/wp/v2/themes` endpoint and, once detected, takes over palette sync: DS palette tokens → Kadence's `kadence_blocks_colors` option via WP Core `/wp/v2/settings`. One-screen Appearance panel in `/admin/sites/[id]/appearance` surfaces Kadence detection status + deep-link to WP Admin when missing, last sync timestamp, dry-run preview of the proposed palette diff, confirm modal naming the site's WP URL, re-sync and rollback actions. Free tier only at launch.

  **Two rescopes shipped against this row:**

  **Rescope 1 (2026-04-24, pre-M13-5a).** Parent plan originally assumed `/wp-json/kadence-blocks/v1/*` exposes palette + typography + spacing globals as a unified REST surface. Source check against `stellarwp/kadence-blocks` found only palette is REST-writable on free tier (via WP Core `/wp/v2/settings` reading `kadence_blocks_colors`). Typography + spacing globals live in the Kadence Theme as Customizer theme mods and have no REST surface on free tier. M13-5 ships **palette-only sync**; typography + spacing sync is deferred to BACKLOG.

  **Rescope 2 (2026-04-24, pre-M13-5c).** Parent plan originally called for Opollo to install + activate Kadence via REST on the operator's behalf. Source check against WP Core's `WP_REST_Themes_Controller` confirmed `/wp/v2/themes` is **read-only** — no POST/PUT/DELETE for install or activate. WP exposes plugin install via REST (`/wp/v2/plugins` POST, WP 5.5+) but intentionally does NOT expose theme install. Chose to document manual operator install rather than ship a mu-plugin bridge — mu-plugin is a paid-tier product surface of its own, deferred to BACKLOG with trigger "first paying operator requests one-click setup". M13-5c ships **detection + palette sync only**; zero WP mutations on the theme itself.

  Appearance panel copy makes both divisions explicit: operator installs Kadence through WP Admin + owns typography + spacing via WP Customizer; Opollo owns palette only.
- **M13-6 — E2E + RUNBOOK.** `e2e/posts.spec.ts` covers upload post-brief → runner produces draft → approve → publish → WP verify (mocked in CI, real in staging). `docs/patterns/brief-driven-generation.md` (shipped with M12-6) gains a post-mode appendix. `docs/RUNBOOK.md` gets entries for the three WP-side blockers (`auth-capability-missing`, `rest-disabled`, `seo-plugin-missing`) plus a Kadence reset recipe for the "operator touched the Customizer anyway" case.

## Out of scope (tracked in BACKLOG.md)

- **Multi-author posts.** One `author_id` per post today. Multi-author requires a join table, per-author royalty/attribution UX, and a conflict-resolution story for co-authored edits — enough scope to be its own milestone.
- **Post scheduling.** `status = 'scheduled'` is accepted at the schema layer (M13-1 CHECK) but M13-5 does not wire WP's `post_date` scheduler. Deferred until we've watched a dozen real posts publish through the manual flow.
- **Custom post types.** Kadence + WP support CPTs; M13 ships only `post`. A future "product posts" or "case-study posts" surface is a BACKLOG-tracked extension that would thread another content_type value through the runner's dispatch.
- **Comment moderation.** WordPress ships serviceable comment moderation. No Opollo surface for it until a paying operator asks.
- **RSS / sitemap automation.** Kadence + WP already emit feeds + sitemaps; Opollo does not own those surfaces.

## Env vars required

None new. ANTHROPIC_API_KEY, Supabase trio, Langfuse, Playwright, Upstash Redis, and the existing per-site WP app password are all the runtime dependencies need. Kadence install uses the per-site WP credentials already provisioned for M7/M11.

## Sub-slice breakdown (6 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M13-1** | Migration 0013: `posts` table with soft-delete + audit + `version_lock` + nullable `wp_post_id` + `content_type` CHECK. Partial UNIQUE `(site_id, wp_post_id) WHERE wp_post_id IS NOT NULL`. RLS matches M2b. `lib/posts.ts` CRUD helpers mirroring `lib/pages.ts`. Integration tests for site-scope guard, `VERSION_CONFLICT`, partial-UNIQUE NULL-distinctness. | Medium — new table + write paths, no billed calls, no concurrent workers. | Nothing (orthogonal to M12). |
| **M13-2** | `lib/wp-posts.ts` REST wrapper. `lib/site-preflight.ts` capability probe. `lib/seo-plugin-detection.ts`. `lib/error-translations.ts` WP → operator message table. Unit tests over fixture responses (Yoast/RankMath/SEOPress/none; 401/403/404/500/`rest_*` error codes). | Medium — billed-free (reads only on preflight). Translation table is pure logic. | Nothing (orthogonal to M12). |
| **M13-3** | `lib/brief-runner.ts` mode parameter + per-mode dispatch table. Post mode skips anchor cycles. Post-specific quality gates (excerpt, featured media, taxonomy whitelist). Budget reservation via M8's `reserveBudget`. Langfuse span per post + per pass. | High — billed Anthropic calls, concurrent-runner guard reuses M12-3's advisory lock. Idempotency key per `(brief_id, post_index, pass_number)`. | M12-3, M13-1, M13-2. |
| **M13-4** | `/admin/sites/[id]/posts` list + detail + `/run` review surface + publish-confirm modal. Assistive-operator-flow blockers (preflight before commit, translated errors on failure, confirm-before-destructive on unpublish/cancel). `auditA11y()` on every visited page. E2E spec. | Medium — admin mutations + destructive actions gated by confirm modals. `VERSION_CONFLICT` surfaced in UI. | M13-3. |
| **M13-5** | Kadence install + activate on site registration. DS tokens → Kadence globals via REST (one-way channel, documented). Appearance panel at `/admin/sites/[id]/appearance` with manual re-sync action. Migration path for M2-era sites. | High — mutates client WP sites (theme install, globals write). Idempotent (re-install is a no-op; re-sync overwrites with same values). Preflight blocker when WP REST lacks install capability. | M13-4. |
| **M13-6** | `e2e/posts.spec.ts` upload → generate → approve → publish with mocked WP. Nightly staging run against real WP. RUNBOOK entries for the three WP-side blockers + Kadence reset recipe. `brief-driven-generation.md` post-mode appendix. | Low — E2E + docs. Mocked WP in CI means no real-site side effects. | M13-5. |

**Execution order:** M13-1 + M13-2 ship in parallel with M12-1/M12-2 (orthogonal). M13-3 hard-blocks on M12-3. M13-4 → M13-5 → M13-6 strictly serial. No slice may execute ahead of its listed `Blocks on`.

## Write-safety contract

- **Posts table writes (M13-1).** All operator edits go through `updatePostMetadata` with `version_lock` + caller-supplied `expected_version`. Zero affected rows → `VERSION_CONFLICT` surfaced to the UI. 23505 on `(site_id, wp_post_id)` partial UNIQUE → `UNIQUE_VIOLATION` with a translated message. Soft-delete is the only delete path; `deleted_at IS NULL` is the default visibility predicate.
- **WP publish (M13-3, M13-4).** Every publish-bound action runs `lib/site-preflight.ts` before the confirm step; the operator never sees "click confirm → get a raw REST failure". A successful publish writes `wp_post_id` and `status = 'published'` in the same UPDATE, predicated on `version_lock`. A race on concurrent publish loses at `version_lock`, not at the UNIQUE.
- **Kadence globals (M13-5).** Install + globals-write are idempotent by design: re-running an install on an already-installed theme returns success; re-syncing globals overwrites with the same values. The Opollo-owns-globals direction is documented in the Appearance panel copy — no "preserve operator edits" option, because introducing that option would force a diff-merge surface nobody needs yet.
- **Runner mode parameter (M13-3).** Exactly one function signature changes on the runner entry point. Per-mode branches live in named helpers behind a dispatch table. A new mode is a new entry in the dispatch, not a new runner. Unit test: both modes exercise the same golden-path steps with only the documented deltas.

## Testing strategy

| Slice | Unit | Integration | E2E |
| --- | --- | --- | --- |
| M13-1 | `lib/posts.ts` shape tests | `lib/__tests__/posts.test.ts` hits real Supabase: site scope, VERSION_CONFLICT, partial-UNIQUE | Covered in M13-4 spec |
| M13-2 | WP REST fixture tests, SEO fingerprint table | — | Covered in M13-4 spec |
| M13-3 | Runner mode dispatch, anchor-skip assertion, quality-gate branches | `brief-runner.test.ts` end-to-end in both modes | Covered in M13-6 spec |
| M13-4 | Modal copy + confirm-modal destructive-action tests | Admin route `PATCH` round-trip | `e2e/posts.spec.ts` list + detail + run + publish flow |
| M13-5 | Kadence REST client fixture tests, globals mapper | — | `e2e/appearance.spec.ts` install + re-sync |
| M13-6 | — | — | Staging nightly against real WP |

Axe `auditA11y()` runs on every visited admin page per the CLAUDE.md E2E contract. Findings non-blocking today; history is building for the Level-3 ratchet.

## Performance notes

A single post generation ≈ one M12 page's cost (multi-pass × one page × whole-brief context). Post briefs are typically smaller than whole-site briefs, so the whole-doc context is cheaper. A batch of posts from one brief runs sequentially — no parallel post generation at launch, because cross-post continuity via running `content_summary` requires a stable ordering. Batched parallel post generation is a BACKLOG extension with its own concurrency story.

## Risks identified and mitigated

| Risk | Mitigation |
| --- | --- |
| **M12 primitive rename breaks M13.** `lib/brief-runner.ts` rename, `site_conventions` struct restructure, visual-review signature change all break M13 silently. | `docs/plans/m12-parent.md` carries a "Downstream dependencies (M13)" section naming every primitive. Code review blocks on a rename that doesn't coordinate through `docs/WORK_IN_FLIGHT.md`. |
| **Operator's WP login lacks `publish_posts` / `upload_files`.** Publish fails late with a raw 403. | M13-2's preflight hits `/wp-json/wp/v2/users/me` and refuses to advance to publish confirm without both capabilities. Translated blocker surfaces before the operator sees a confirm button. |
| **SEO plugin missing, meta writes silently dropped.** Post publishes without Yoast/RankMath meta fields the brief requested. | `lib/seo-plugin-detection.ts` fingerprints the plugin on preflight. Missing plugin → UI warning before commit; brief-declared SEO fields gate publish if the plugin isn't present. |
| **Kadence global vs. manual Customizer conflict.** Operator edited the Customizer; re-sync overwrites their edit. | Appearance panel copy states the channel is one-way. Re-sync button has a confirm modal naming the exact overwrite. A "last synced at" timestamp makes the overwrite window visible. |
| **Featured image missing silently.** Post publishes without a featured image on a theme that requires one. | Post-specific quality gate (M13-3) checks featured-media presence when the site's theme + SEO plugin require it. Gate failure blocks approval with a translated message. |
| **WP category auto-create surprise.** Brief declares a category; WP REST auto-creates a new taxonomy term rather than matching an existing one. | M13-2's taxonomy helper resolves against `/wp/v2/categories` before creating. No silent term creation — the operator confirms new terms on the preflight screen. |
| **Runner mode regression: post mode runs anchor cycles anyway.** Silent cost blowout. | M13-3 unit test asserts anchor-cycle count is 0 when `mode === 'post'`. Langfuse span names include the mode; a production anchor cycle on a post surfaces as a wrong-span-name alert. |

Gaps deliberately deferred: post autosave on the editor surface (BACKLOG), rich-media embeds beyond featured image (BACKLOG), Kadence paid-tier block coverage (BACKLOG).

## Relationship to existing patterns

- `docs/patterns/assistive-operator-flow.md` (PR #99) governs every operator-facing surface M13 adds. Preflight before commit, translated errors on every failure path, confirm-before-destructive on unpublish / cancel / re-sync.
- `docs/plans/m12-parent.md` is the engine contract M13 extends. Anchor-skip rule + per-brief `content_summary` + Kadence-rendered visual review are the three deltas; everything else is inherited.
- `docs/DATA_CONVENTIONS.md` shapes M13-1 (soft-delete, audit columns, `version_lock`, CHECK over ENUM, partial UNIQUE on nullable integration ids).
- `docs/CONTEXT.md` is the coordination anchor — any M13 session reads it first, respects the "M13 must not modify M12 primitives" rule, and follows the hard-pause / resume-after-dead-session protocol.
- **Candidate for promotion:** `kadence-global-mapping` as a new pattern under `docs/patterns/` once M13-5 ships. The DS-tokens-to-WP-theme-globals shape is likely reusable for future theme integrations (Blocksy, GeneratePress) if Kadence doesn't stay the only supported theme.

## Sub-slice status tracker

- [ ] M13-1 — posts schema + content_type axis + lib/posts.ts
- [ ] M13-2 — WP REST + preflight + SEO detection + error translations
- [ ] M13-3 — brief-runner mode parameter (BLOCKED on M12-3)
- [ ] M13-4 — /admin/sites/[id]/posts admin surface
- [ ] M13-5 — Kadence install + Appearance panel
- [ ] M13-6 — E2E + RUNBOOK
