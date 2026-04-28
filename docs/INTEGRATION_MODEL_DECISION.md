# Integration model decision — rescope (2026-04-29)

UAT smoke 1 was halted on 2026-04-29 because the cascade of fixes (PR #188 max_tokens bump, PR #189 truncation banner, PR #190/#191 backlog entries) revealed a structural mismatch between what Opollo produces and how WordPress hosts the result. The fixes in flight were correct for the surface symptoms but did not address the underlying integration model.

This document captures three integration paths, evaluates each across the five live subsystems, and surfaces the trade-offs. **It does not recommend a path.** Steven decides.

The brief_pages.draft_html on `dcbdf7d5-b867-443b-afdf-f60a28f968aa` is preserved as evidence of "what current behaviour produces" — do not modify.

---

## Three paths

### Path A — Full standalone documents (current behaviour)

**What Opollo produces.** A complete HTML document per page or post:

```html
<!DOCTYPE html>
<html data-ds-version="..." lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" .../>
    <meta name="description" .../>
    <style>
      body { background: #0a0e1a; color: #e8eaf6; ... }
      .s1231-services-grid { ... }
      ...
    </style>
  </head>
  <body>
    <nav>...</nav>
    <main>...</main>
    <footer>...</footer>
  </body>
</html>
```

The doc is self-contained: layout, type, palette, spacing, semantics — all baked in.

**What the host WP needs.** Nothing. The doc renders standalone.

**How publish works today.** WP REST `POST /wp-json/wp/v2/pages` (or `/posts`) with `content` = the full HTML. WordPress treats the entire blob as page content; the active theme renders its chrome (header, nav, footer, sidebars) **around** the content area.

**Migration cost.** Zero — this is current state. M3 / M7 / M12 / publish paths all assume this shape.

**Implications across live subsystems.**

- **M3 batch runner.** Works as-is. Generates one full doc per slot. Quality gates check DOCTYPE, `<html>`, body structure. Validators in `lib/runner-gates.ts` and the structural-completeness check in `lib/brief-runner.ts` (PR #188) target this shape.
- **M7 regen runner.** Works as-is. Re-emits a full doc; idempotency keys keyed on `(site, page_or_slot)`.
- **M12 brief runner.** Works as-is. The anchor cycle locks tokens-level conventions (typographic scale, section rhythm) inside the `<style>` block; pages 2..N inherit by re-emitting compatible style blocks. The runner's "previousDraft" context is a complete prior doc.
- **M13 Kadence sync.** Largely **decorative**. Opollo's full doc carries its own CSS, so the WP theme's palette has no effect on Opollo content. Kadence sync only matters for whatever WP chrome surrounds the content area, which the operator may never look at.
- **Publish paths.** The `wp-rest-posts` and `wp-rest-pages` wrappers POST the full HTML. The published page renders Opollo content inside a theme-decorated frame. **Visual collision is the norm**: Opollo's `body { background: #0a0e1a }` doesn't apply to the WP `<body>` (the doc gets parsed inside the WP page's content area, so the inline `<body>` becomes a nested `<body>` and most browsers tolerate but ignore the styling), Opollo's font stack fights the theme's, etc. The "Show rendered preview" iframe in `BriefRunClient` shows the doc in isolation — useful for QA but **not** representative of production rendering.

**Trade-offs.**

| Pro | Con |
|---|---|
| Self-contained; no host theme dependency | Visually clashes with WP theme chrome |
| Deterministic preview matches what Opollo "thinks" the page is | Production rendering ≠ preview rendering |
| Easy to QA in isolation | Content is opaque to WP plugins (SEO, accessibility, page builders, search indexers that walk Gutenberg blocks) |
| No surface area in the host WP install | Edits require regenerating the whole doc; no operator hand-edit path |
| | Token cost per page is highest (entire doc emitted on every revise) |
| | M13 Kadence work has limited reach — cosmetic only |

**Where it breaks down.** The visual collision is the load-bearing failure mode. UAT smoke 1's "black box" symptom was a content bug (truncated CSS), but the next layer down — even with the doc complete — is a published page that doesn't visually match the rest of the WP site. The operator has no in-WP way to tweak a heading or fix a typo without regenerating.

---

### Path B — Fragment (body content only; theme provides chrome)

**What Opollo produces.** A scoped HTML fragment, no document chrome:

```html
<section data-opollo class="hero">
  <h1>...</h1>
  <p>...</p>
  <a class="cta" href="...">...</a>
</section>
<section data-opollo class="features">...</section>
<section data-opollo class="cta-band">...</section>
```

No `<!DOCTYPE>`, `<html>`, `<head>`, `<style>`, `<body>`. Inline styles are minimal or absent; layout uses utility classes that the theme defines, OR scoped class names with the runner emitting a small companion stylesheet bundled separately.

**What the host WP needs.** A **theme contract**: the active theme provides container width, font stack, color palette, basic typography, and a known set of utility / layout classes (or the runner's class scheme matches a known theme's CSS). For Opollo's planned Kadence-based deployments, this is the Kadence Blocks CSS + the global colour palette synced via M13.

**How publish works.** Same WP REST POST, but `content` is the fragment. The theme wraps it with `<header>` / `<nav>` / `<footer>` and the page's HTML chrome is the theme's. The fragment inherits the theme's tokens.

**Migration cost.** Substantial (~2–4 weeks).

- Runner prompts rewritten to forbid document chrome and inline `<style>` blocks beyond a tiny scoped allowance.
- Quality gates rewritten: `runGatesForBriefPage` no longer checks DOCTYPE / closing `</html>` (PR #188's structural gate); it instead validates the fragment's top-level shape (sections balanced, no leaked head elements, no nested `<body>`).
- Preview iframe in `BriefRunClient` needs an injected wrapper that loads the host theme's stylesheet, otherwise the preview shows unstyled HTML and operators can't QA visually. Two paths: (1) iframe srcDoc wraps the fragment in a synthetic `<html>` that links to the theme's CSS via a known URL on the WP site, requires CSP allowance for that origin; (2) operator pastes a "preview snapshot" from the live site as a fixture.
- M2-era full-doc generations need a one-time migration: either regenerate (cost) or extract their `<body>` content (lossy — strips the inline `<style>` they currently rely on).

**Implications across live subsystems.**

- **M3 batch runner.** Prompt rework. Output validators change shape. Per-slot cost drops ~30–50% (fragment is shorter than full doc). Existing generation_events / generation_jobs schema unaffected.
- **M7 regen runner.** Same prompt rework. Cost drops similarly. Existing regen events keep their shape.
- **M12 brief runner.** Same prompt rework, plus the anchor cycle's role narrows: instead of locking head-level CSS conventions, the anchor pattern locks **content composition** (section ordering, content types per section). The "stable design system tokens" the anchor cycle currently emits become irrelevant — the theme owns those.
- **M13 Kadence sync.** **Load-bearing.** The theme's palette + typography + spacing become the visual contract. M13's existing CSS-token-to-Kadence sync is no longer cosmetic; it's the only mechanism that makes Opollo content render as designed. Sync drift is a **content bug**, not a polish item.
- **Publish paths.** Wrappers stay the same shape (POST `content` field). Existing M3 / M7 idempotency continues to work. The preview iframe's accuracy improves (matches production wrap), at the cost of needing theme CSS access during preview.

**Trade-offs.**

| Pro | Con |
|---|---|
| Visually consistent with WP site | Hard dependency on host theme contract |
| ~30–50% smaller token budget per page | Preview iframe needs theme CSS injection (CSP / asset path complexity) |
| WP plugins (SEO, accessibility, search) can operate on the content | M13 Kadence sync becomes load-bearing — sync bugs are content bugs |
| Operators can hand-edit content in WP block editor without going through Opollo | M2-era generations need migration or regen |
| Preview matches production once theme injection works | Every theme change risks visual regression on existing Opollo content |
| Smaller LLM output → fewer max_tokens hits, faster runs | Testing requires a representative theme fixture, not just a browser |

---

### Path C — Templated (page-builder blocks / template slots)

**What Opollo produces.** Structured content that fits a page builder. Two sub-shapes — pick one or both:

- **Gutenberg block markup:** `<!-- wp:kadence/rowlayout {"id":"hero","palette":"primary"} --><!-- wp:kadence/heading {"text":"..."} /--><!-- /wp:kadence/rowlayout -->`
- **Structured JSON:** a Zod-validated payload like `{ "sections": [{"template": "hero-v3", "fields": {"headline": "...", "cta": {...}}}, {"template": "features-v2", ...}] }` translated to block markup at publish time.

Either way, Opollo emits content that **slots into a curated template library** rather than producing freeform HTML.

**What the host WP needs.** A page builder (Kadence Blocks, Gutenberg core, ACF Flexible Content, Beaver Builder, etc.) **plus** a fixed template library that Opollo's runner is prompted against. The integration locks Opollo to whichever builder the templates target — Kadence is the obvious choice given M13's existing investment.

**How publish works.** WP REST POST with `content` = block markup, OR POST to a custom endpoint that translates Opollo JSON → block markup at the boundary. The published page is editable in the WP block editor like any other Kadence page; operators tweak headings, swap images, reorder sections without ever touching Opollo.

**Migration cost.** Large (~6–12 weeks).

- Curate a template registry: 8–20 reusable section templates (Hero, Features, CTA Band, Testimonial Grid, Pricing Table, FAQ, Footer Pre-Footer, etc.) with field schemas, design variants, and ranges of acceptable input.
- Build the publish-side translator (JSON → Gutenberg block markup) as a new path next to `wp-rest-posts.ts`.
- Rewrite the runner prompts to emit against the schema, not freeform HTML.
- New quality gates that validate block schema, not HTML structure.
- Build per-template visual regression fixtures (each template rendered at ~3 representative variants).
- Operator-facing: a template-picker UI for novel composition needs, since the runner can't invent new templates.
- Existing M2 / M3 generations are obsolete or need re-generation through the new pipeline.

**Implications across live subsystems.**

- **M3 batch runner.** Full prompt + validator rewrite. Outputs constrained to block schemas. Quality gates entirely different (schema-based, not HTML-based). Cost per generation drops dramatically (Claude is much better at constrained structured output than freeform 16K-token HTML).
- **M7 regen runner.** Same rewrite. Idempotency simpler (schema diffs are easier to compare than HTML diffs).
- **M12 brief runner.** Anchor cycle changes nature: instead of locking CSS conventions, locks a **section composition pattern** for the brand (e.g., "this brand consistently uses Hero → 3-column Features → Testimonial Carousel → CTA Band"). The anchor pattern lives in `site_conventions` as a JSON structure rather than a CSS-tokens blob. The visual review loop can become tighter — the runner is no longer asking Claude to render layouts; it's asking which template variant best fits the section content.
- **M13 Kadence sync.** **Backbone.** Kadence Blocks IS the templated system. M13's palette / typography sync is the design-system contract that templates are validated against. Adding a new template = adding a row to the registry, not retraining a prompt.
- **Publish paths.** New path required: block-markup writer next to `wp-rest-posts.ts`. The existing wp_post_id + idempotency-key shape carries over. WP Media transfers (images via M4) work unchanged. The page renders in the production WP environment with full block-editor compatibility — operators can rearrange sections, tweak copy, swap images, all without leaving WP.

**Trade-offs.**

| Pro | Con |
|---|---|
| Full WP-native integration; operator can hand-edit any field in the block editor | Enormous up-front investment in template registry curation |
| Smallest LLM token budget per page (structured output) | Locks Opollo to a specific page builder (Kadence, presumably) — hard to switch later |
| SEO / accessibility / search plugins fully functional | Less flexibility for novel layouts — need a registry update for any new section type |
| Deterministic preview (uses production block stack) | Existing M2 generations are obsolete |
| Block schema is testable (Zod / JSON Schema) — quality gates become cheap and precise | Testing surface includes the block registry itself, which is ongoing work |
| Visual regressions limited to template-level changes — easy to catch | Initial milestone-equivalent work is M14-or-later scoped |
| Cost-per-page much lower than freeform HTML | Visual freedom is bounded by what the registry contains |

---

## Summary table

| Aspect | A: Full docs (current) | B: Fragment | C: Templated |
|---|---|---|---|
| Opollo emits | Complete HTML doc | Body fragment | Block markup / JSON |
| Host WP needs | Nothing | Theme contract | Page builder + template registry |
| Migration from current | None | Medium (prompt + validators + preview iframe) | Large (registry + new publish path + prompt rewrite) |
| Visual fit with WP theme | Clashes | Inherits | Native |
| Operator hand-edit | Regenerate only | WP block editor (limited) | WP block editor (full) |
| Token cost per page | Highest | Medium | Lowest |
| Preview fidelity | Self-contained, ≠ production | Matches production once theme CSS loads | Matches production exactly |
| Quality gate complexity | HTML structure | Fragment shape | Block schema |
| M3 batch impact | None | Prompt rework | Major rewrite |
| M7 regen impact | None | Prompt rework | Major rewrite |
| M12 brief runner impact | None | Prompt rework; anchor narrows | Major rewrite; anchor reframes to composition pattern |
| M13 Kadence sync impact | Decorative | Load-bearing | Backbone |
| Publish path impact | None | None (still POSTs `content`) | New translator path |
| Failure mode under rate limits | Frequent (max_tokens=16384 vs 4K/min cap) | Rare (smaller outputs) | Vanishing (small structured output) |
| Operator surface in WP | Read-only | Editable as HTML | Fully editable in block UI |

---

## Current state vs needed state

**Current state.** The production stack is wired end-to-end for path A:

- `lib/brief-runner.ts` emits and gates full HTML documents (PR #188 structural gate enforces `<!DOCTYPE>` / `<html>` / `</body>` / `</html>` closure).
- `lib/wp-rest-posts.ts` and `lib/wp-rest-pages.ts` POST `content` = full HTML doc.
- `components/BriefRunClient.tsx` previews via iframe `srcDoc=` the full doc. The truncation banner from PR #189 only fires on path-A shapes.
- `lib/runner-gates.ts` validates full-doc shape: DOCTYPE, html opener, body presence, head structure.
- `lib/site-preflight.ts` checks WP capabilities to publish full-doc content via REST.
- Migrations 0007 (M3 generation_jobs / generation_events), 0010 (M4 image_library), 0013 (M12 briefs schema), 0018 (M12-3 runner_state) all assume the page's primary artifact is `text` (i.e. an HTML doc).
- M13's appearance sync (migration 0022) writes Kadence palette to WP, but no Opollo-emitted content reads from that palette — the path-A doc carries its own colours.

**Needed state per path.**

| | Path B target | Path C target |
|---|---|---|
| Runner prompts | Forbid doc chrome; emit fragments only | Emit against block schema; no freeform HTML |
| Quality gates | Fragment shape validators | Schema validators (Zod / JSON Schema) |
| Preview iframe | Wrap fragment in synthetic doc with theme CSS link | Render in WP block editor (or stub block renderer) |
| Publish path | Unchanged (still POSTs `content`) | New: JSON → block markup translator |
| `site_conventions` row | Drops CSS tokens; keeps brand voice + composition hints | Stores section-composition pattern as structured JSON |
| M13 sync | Tracked + tested as a content path, not a polish item | Tracked + tested as the backbone |
| Anchor cycle | Lighter — locks brand voice + composition, not visual tokens | Lighter — locks composition pattern only |
| Existing M2 data | Migrate-by-extraction (lossy) or regenerate | Regenerate through new pipeline |
| `RUNNER_MAX_TOKENS` | Drops back to 4K-ish (fragment fits comfortably) | Drops below 4K (structured output is small) |

**Live evidence on disk for what current behaviour produces.** Page `dcbdf7d5-b867-443b-afdf-f60a28f968aa` carries a 26,286-char draft_html that exemplifies path A: full DOCTYPE, scoped class names like `.s1231-services-grid`, inline CSS that defines its own palette / typography / spacing, no dependency on host WP. Preserved as-is per the halt directive — DO NOT regenerate or wipe.

---

## Open questions Steven might want to bottom out before deciding

1. **Operator workflow.** How much hand-editing post-generation is "normal"? If operators routinely tweak copy / swap images / reorder sections, paths B and C are dramatically better than A. If generation-then-publish is the dominant workflow, A's current pain is tolerable.
2. **Visual freedom vs consistency.** How much does the team value Opollo emitting "novel" layouts vs every page looking like a coherent member of the same brand? Path C is the most consistent; path A is the most freeform.
3. **Which page builder does the customer base actually use?** Path C locks Opollo to one. If that's Kadence (M13's existing investment suggests so), the lock is acceptable. If customers use mixed builders (Elementor, Beaver, Gutenberg-core), path C's registry has to multiply.
4. **Time to first paying customer.** Path A keeps shipping today's behaviour (with the rate-limit and truncation gaps tolerated as known issues). Path B is mid-quarter scoped. Path C is end-of-year scoped at minimum.
5. **Existing data migration tolerance.** Are the M2-era full-doc generations regenerable for free, or is there content the customer has already approved that you'd lose?
6. **M13 budget.** M13's Kadence work was scoped under path A's assumption (decorative). If path B or C lands, M13's scope needs reframing — possibly more work, possibly less, depending on the path.

---

## Halt status

- UAT smoke 1: paused. No further generation cycles.
- Open PRs: none in flight as of 2026-04-29 (#191 was the last shipped).
- Page `dcbdf7d5-...`: preserved as-is. `page_status='awaiting_review'`, `draft_html=26,286 chars` (complete path-A doc).
- No further code changes will ship until the integration model is decided.
