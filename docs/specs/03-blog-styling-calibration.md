# Spec 03 — Blog styling calibration for copy_existing sites

**Owner:** Steven
**Audience:** Claude Code
**Mode:** Autonomous build. Do not stop to ask questions. Every decision is locked. Pause only for genuinely missing env vars or contradictions with `docs/ARCHITECTURE.md`.

**Estimated PRs:** 3 — (1) extraction extension + schema, (2) preflight + UI gating, (3) build-injection wiring
**Blocks:** Better blog post quality on `copy_existing` sites
**Depends on:** Nothing strictly. Independent of Spec 01 and Spec 02.

---

## 0. Read this first

Read `docs/ARCHITECTURE.md` sections 4, 5, 17, 18 before code.

Hard constraints:

- §5: site mode dispatch is load-bearing. `lib/design-discovery/build-injection.ts` orchestrates. Mode-aware split is intentional. Do not collapse.
- §17: Path B is hard-locked. Fragments only, inline CSS budget capped at 200 chars. Output of this work feeds the prompt; it does not bypass Path B.
- §18: `lib/brief-runner.ts` cannot be refactored without explicit Steven approval. **This spec does NOT modify the runner.** All work is upstream of it. If during implementation it becomes clear the runner *must* change, abort the PR and surface the issue rather than proceeding.

Background facts:

- M13 is shipped. `<blog_post_guidance>` lives in `lib/brief-runner.ts:656-661`, mode-aware (copy_existing → no inline CSS, new_design → cap at 3 rules).
- `lib/site-preflight.ts` exists with blocker codes `AUTH_CAPABILITY_MISSING, REST_UNREACHABLE, REST_AUTH_FAILED, SITE_CONFIG_MISSING`. Extend it.
- `lib/error-translations.ts` covers 7 categories. Extend it.
- Current extractor (`lib/copy-existing-extract.ts`) captures only 6 CSS class buckets: `container, button, card, h1, h2, h3`. Extra pages pass through to `source_pages` for provenance only — they are not actually scanned today.
- The wizard at `/admin/sites/[id]/setup/extract` is the only UI surface. There is no separate `ExtractedProfilePanel` component.
- Kadence sync is for `new_design` only. For `copy_existing` blog posts, the existing theme owns blog styling, but the runner only knows landing-page-style classes today.

Gap this spec closes: extract blog-content-specific styling from real blog URLs on the customer's existing site, store in `extracted_design.blog_styling`, gate blog publishing on its presence, inject into runner prompt for `content_type='post'` runs.

---

## 1. PR 1 — Extraction extension and schema

### 1.1 Schema extension

Extend `extracted_design` JSONB with a `blog_styling` sub-key. No new table, no new column. Reuse existing JSONB.

```ts
// extension to ExtractedDesign in lib/copy-existing-extract.ts:29

interface BlogStyling {
  source_blog_urls: string[];     // 1-3 operator-supplied blog URLs

  // Article container
  article_container: string | null;

  // Body content classes
  paragraph: string | null;
  link_in_body: string | null;

  // Long-form structural elements
  blockquote: string | null;
  unordered_list: string | null;
  ordered_list: string | null;
  list_item: string | null;
  figure: string | null;
  figcaption: string | null;
  code_inline: string | null;
  code_block: string | null;
  hr: string | null;

  // Heading classes inside articles
  article_h2: string | null;
  article_h3: string | null;
  article_h4: string | null;

  // Diagnostics
  notes: string[];
  extracted_at: string;           // ISO timestamp
}
```

Update `ExtractedDesignSchema` (Zod) in `app/api/admin/sites/[id]/setup/extract/save/route.ts:26` and the type in `lib/copy-existing-extract.ts:29`.

`blog_styling` is **optional** on the schema. Sites without it are valid; preflight (PR 2) gates at publish time.

No migration — JSONB extension is transparent.

### 1.2 Extractor extension

Add `extractBlogStyling()` to `lib/copy-existing-extract.ts`:

```ts
async function extractBlogStyling(
  primaryUrl: string,
  blogUrls: string[]
): Promise<{ blog_styling: BlogStyling; notes: string[] }>
```

Implementation rules (locked):

- For each blog URL (max 3), `fetch()` with 8s timeout — same pattern as the existing extractor. No Playwright. No headless browser.
- Same-origin filter: blog URLs must share **the registrable domain** of `primaryUrl`. Subdomains allowed (e.g., `blog.example.com` with site `example.com`). Different registrable domains dropped with a note.
- Implementation of registrable-domain check: **first, check if `psl` (Public Suffix List) or equivalent is already in `package.json` dependencies**. If yes, use it. If no, inline a hand-rolled check: extract host from URL, split on `.`, take last two labels for most TLDs. For multi-part TLDs (`.co.uk`, `.com.au`, `.co.nz`, `.com.br`) take last three. Hardcoded list of multi-part TLDs is acceptable scope — covers all reasonable customer domains. Document in code: `// Limitation: hand-rolled registrable-domain detection. Edge-case domains (github.io, appspot.com, *.cloudfront.net) may misclassify as different domains.` This limitation is acceptable; real customer sites are conventional registrable domains.
- Inside each fetched HTML body, identify the article container by trying selectors in order: `<article>`, `<main>`, `.post-content`, `.entry-content`, `.single-post-content`. First match wins. None match: skip that URL with a note.
- **Diagnostic logging on each extraction:** log which selector matched, the byte size of the matched node's HTML, the count of direct child elements. These logs are the only signal when extraction quality degrades.
- Inside the matched container, regex-tally classes on bucketed elements (`<p>`, `<a>` inside `<p>`, `<blockquote>`, etc.). Use the same frequency-tally approach as the existing class extraction code.

**Utility-class filtering (locked) — applied to every bucket extraction:**

When tallying classes on an element, apply these filters in order before frequency counting:

1. Reject classes matching common Tailwind/utility patterns:
   - `^(m|p|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py)-` (margin/padding utilities)
   - `^(w|h|min-w|min-h|max-w|max-h)-` (sizing utilities)
   - `^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)$` (text sizing — but allow longer semantic class names containing these as substrings)
   - `^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$`
   - `^(bg|border|rounded|shadow)-` (background/border utilities)
   - `^(flex|grid|gap|space|items|justify|content|self|order)-?` (layout utilities)
   - `^(sm|md|lg|xl|2xl):` (responsive prefixes — full class with prefix rejected)
2. Reject classes shorter than 4 characters (common utility heuristic).
3. Reject classes matching `^[a-z]$` (single-letter).
4. Of remaining classes, prefer the longest by character length when frequencies tie. Longer classes are more likely to be semantic.

These filters apply per-element. The result is a single class per bucket, even when the source HTML uses multi-class strings like `class="entry-content prose lg:prose-xl"` — the filters reject `prose`, `lg:prose-xl`, leaving `entry-content` as the single semantic value.

**Single-class-per-bucket contract:** every bucket in `BlogStyling` stores exactly one class string (or null). Multi-class scenarios resolve to the longest semantic survivor of the filter. The Zod regex on save (§1.4) validates this single-class shape: `/^[a-zA-Z_][a-zA-Z0-9_-]*$/`. If the operator manually edits a bucket value to include spaces or multiple classes, Zod rejects it with a clear error: `"Bucket values must be a single CSS class name. Pick the most semantic one."`

- Cross-URL consistency:
  - 3 URLs all reachable, all 3 agree: take the value
  - 3 URLs all reachable, 2 agree: take majority, add note `"Blog 3 had different {bucket} class — using majority"`
  - 3 URLs all reachable, all differ: leave bucket null, add note `"Inconsistent {bucket} classes across blogs — leaving null"`
  - 2 URLs reachable, both agree: take it
  - 2 URLs reachable, differ: leave null, add note
  - 1 URL reachable: take whatever found, add note `"Single-URL extraction — confidence is low; consider providing 2 more blog URLs"`
  - **Timeout/fetch failure on any URL:** treat that URL as unreachable. Add note `"URL {n} failed to load: {reason}"`. Continue with remaining URLs using the merge rules above for the reduced count. Example: 3 URLs provided, URL 2 times out → treat as 2-URL merge with URLs 1 and 3 + the timeout note.
- Return `BlogStyling` with `extracted_at: new Date().toISOString()`.

Tests in `lib/__tests__/copy-existing-extract-blog.test.ts`:

- 3-URL agree case
- 3-URL majority case
- 3-URL all-differ case
- 2-URL agree case
- 1-URL case
- Same-origin reject (different registrable domain)
- Same-origin accept (subdomain)
- No article container found
- Multi-part TLD edge cases (e.g., `.co.uk`, `.com.au`)
- **Utility-class filtering:** input `<p class="mb-4 text-gray-700 entry-content">` extracts `entry-content`, not `mb-4` or `text-gray-700`
- **Utility-class filtering edge cases:** input `<p class="mb-4">` (no semantic class) leaves bucket null
- **Malformed HTML:** invalid markup, partial article nodes, missing `<body>` — extractor does not crash, returns null/empty buckets with notes
- **Duplicate classes in same element:** `<p class="entry-content entry-content">` resolves to `entry-content` once, not double-counted
- **Timeout-during-extraction merge:** URL 1 succeeds, URL 2 times out, URL 3 succeeds → merged as 2-URL case with timeout note
- **Multi-class with multiple semantic classes:** `<p class="entry-content prose-lg article-body">` after utility filtering, longest semantic class wins (`entry-content` if `article-body` is shorter; longest of remaining survivors)

### 1.3 Wizard UI extension

Extend `app/admin/sites/[id]/setup/extract/page.tsx` (and child components) with a new section between "Review the design profile" and the Save button.

Section header: **"Blog styling (optional)"**

Initial state: collapsed by default. Helper text inside the collapsed-state header: `"Calibrate how blog posts are styled on your existing site"`.

Expanded state UI:

- Helper paragraph: `"Paste 1–3 example blog post URLs from this site. We'll learn how your blog posts are styled and apply that to generated content. Optional but recommended for sites that publish blogs."`
- Three text inputs for blog URLs, labeled "Blog URL 1", "Blog URL 2", "Blog URL 3". The first is required when the section has any input; the second and third are optional.
- Same-origin client-side validation: as URL is typed, if its registrable domain doesn't match `sites.wp_url`, show inline error `"Must be on the same site"` below the input.
- "Extract blog styling" button. Disabled when zero URLs provided. While running: same loading state as the main extraction.
- **Result rendering after extraction:** editable monospace text inputs for every bucketed class in `BlogStyling`, **grouped visually under sub-headings**:
  - **Container** — `article_container`
  - **Text** — `paragraph`, `link_in_body`
  - **Headings** — `article_h2`, `article_h3`, `article_h4`
  - **Lists** — `unordered_list`, `ordered_list`, `list_item`
  - **Media** — `figure`, `figcaption`
  - **Block elements** — `blockquote`, `hr`
  - **Code** — `code_inline`, `code_block`
  Sub-headings render at `text-subsection` size from Spec 02. Empty fields → null on save.
- **`extracted_at` age display:** if `blog_styling.extracted_at` is set, show a small muted line near the section header: `"Calibrated {N} days ago"` using the same date library used elsewhere. Null shows nothing. No automated drift warning at this time — operator-driven re-extraction only.
- Notes from the extractor render as a small bulleted list below the result fields, in muted text.
- "Re-extract" button replaces "Extract blog styling" once a result is shown.

Auto-expand condition: the section auto-expands on page load if the URL contains `?focus=blog-styling` (used by the preflight banner link in PR 2).

Save behavior: the existing Save button now also persists `blog_styling` if any blog URL is non-empty. Saving with no blog URLs leaves `blog_styling = null` (acceptable — preflight catches at publish time).

### 1.4 Files touched in PR 1

- `lib/copy-existing-extract.ts` — extend types, add `extractBlogStyling()`, registrable-domain helper
- `app/api/admin/sites/[id]/setup/extract/route.ts` — accept `blog_urls` in request body, call extractor when provided
- `app/api/admin/sites/[id]/setup/extract/save/route.ts` — extend Zod schema, persist `blog_styling`
- `app/admin/sites/[id]/setup/extract/page.tsx` and child components — UI extension
- `lib/__tests__/copy-existing-extract-blog.test.ts` — new tests

No migration. No runner change. No preflight change yet.

---

## 2. PR 2 — Preflight gating and UI banner

### 2.1 New preflight blocker

Extend `lib/site-preflight.ts` with new blocker code: `BLOG_STYLE_NOT_CALIBRATED`.

Fires when ALL of:

1. The preflight call is for `content_type='post'`
2. The site's `site_mode='copy_existing'`
3. `extracted_design.blog_styling` is null OR `blog_styling.source_blog_urls` is empty

Does NOT fire for `new_design` mode (Kadence sync owns blog styling there).
Does NOT fire for `site_mode=null` (the existing onboarding banner handles unconfigured sites).
Does NOT fire for `content_type='page'` (page generation unaffected).

The blocker is returned alongside other preflight failures. An operator may have both `BLOG_STYLE_NOT_CALIBRATED` and `REST_AUTH_FAILED` simultaneously. Surface both.

Add to the existing blocker code union/enum in `lib/site-preflight.ts`. Update all callers that pattern-match on the blocker codes to include the new case.

### 2.2 New error translation

Extend `lib/error-translations.ts` with an entry for `BLOG_STYLE_NOT_CALIBRATED`. Operator-facing copy:

```
Title: Blog styling not calibrated
Body: This site is in "copy existing" mode, but we haven't learned how its
      blog posts are styled yet. Generated blog posts may not match your
      site's design.
Action: Calibrate blog styling →
Action target: /admin/sites/[id]/setup/extract?focus=blog-styling
```

The link target is read by the wizard per §1.3 to auto-expand the blog-styling section.

### 2.3 Hard gate (no "Continue anyway")

The blocker is non-bypassable. There is no "Continue anyway" button. Generating a blog without `blog_styling` on a `copy_existing` site produces visibly wrong-looking HTML (model falls back to landing-page class hints), so blocking is correct.

### 2.4 UI surfaces that read the blocker

Surface the blocker on:

- **Site detail page** (`app/admin/sites/[id]/page.tsx`) — inline banner above main content. Use the same banner component as the existing "Set up your design direction and tone of voice..." banner. Non-dismissible. Only renders when blocker would fire (i.e., on `copy_existing` sites without blog_styling — does not show on sites that haven't yet picked a mode, those have a different banner already).
- **Posts surface** (`app/admin/sites/[id]/posts/page.tsx`) — banner at top + disable any "+ New Post" / "Run blog batch" CTAs. Disabled CTAs get a tooltip: `"Calibrate blog styling first"`.
- **Run page** (`app/admin/sites/[id]/briefs/[brief_id]/run/page.tsx`) — if the brief has `content_type='post'` and the blocker is active, block run-start. The "Start" button is disabled with the same tooltip. Banner at top.

Banner copy (from §2.2):

```
[icon] Blog styling not calibrated
       This site is in "copy existing" mode, but we haven't learned how its
       blog posts are styled yet. Generated blog posts may not match your
       site's design.
       [Calibrate blog styling →]
```

### 2.5 Bulk handling

For any bulk-blog-upload surface that exists or ships in the future: apply the gate at the site-picker step. If the operator picks a site where the blocker fires, show the banner immediately and disable the file-drop / paste interface.

For PR 2: search for existing bulk surfaces by greping `app/admin` for "bulk", "Upload multiple", or "/admin/posts/new". If found, integrate the gate. If not found, no work needed — leave a comment in the preflight code: `// NOTE: bulk-blog-upload surface (if added later) must respect this blocker per Spec 03 §2.5`.

### 2.6 Files touched in PR 2

- `lib/site-preflight.ts` — new blocker code, check function
- `lib/error-translations.ts` — new translation
- `lib/__tests__/site-preflight.test.ts` — tests covering mode gate, content_type gate, presence check
- `app/admin/sites/[id]/page.tsx` — banner
- `app/admin/sites/[id]/posts/page.tsx` (or wherever posts list lives) — banner + disabled CTAs
- `app/admin/sites/[id]/briefs/[brief_id]/run/page.tsx` — banner + run-start block
- `e2e/blog-styling-gate.spec.ts` — new Playwright spec

No migration. No build-injection change yet.

### 2.7 Playwright spec for PR 2

Happy path: navigate to a `copy_existing` site without `blog_styling`. Assert banner shows. Click "Calibrate blog styling →". Wizard opens, blog-styling section auto-expanded. Fill in 3 valid blog URLs. Click "Extract blog styling". Wait for result. Click "Save". Navigate back to site detail. Assert banner no longer shows.

---

## 3. PR 3 — Runner injection

### 3.1 build-injection.ts extension

Extend `lib/design-discovery/build-injection.ts`. Locate the function `renderCopyExistingInjection` (around line 118 per the diagnostic).

When `extracted_design.blog_styling` is present AND the runner context indicates `content_type='post'`, emit a new prompt block alongside the existing `<existing_theme_context>` block.

Locate the `content_type` discriminator at injection time. Per the diagnostic, the path is `ctx.brief.content_type` (mirrors the pattern at `lib/brief-runner.ts:656-661`). Read `lib/design-discovery/build-injection.ts` at the start of PR 3 to confirm the actual field path. If different, use the actual path and adjust this spec's wording in the PR description.

New block format:

```
<blog_content_classes>
When generating blog post content (long-form articles), use these existing CSS classes
on the matching elements. Drop the `.` prefix when applying as className. If a bucket
is null, fall back to plain semantic tags without a class.

article_container: .{value or "(none — use plain <article>)"}
paragraph: .{value or "(none — use plain <p>)"}
link_in_body: .{value or "(none)"}
blockquote: .{value or "(none — use plain <blockquote>)"}
unordered_list: .{value or "(none — use plain <ul>)"}
ordered_list: .{value or "(none — use plain <ol>)"}
list_item: .{value or "(none — use plain <li>)"}
figure: .{value or "(none — use plain <figure>)"}
figcaption: .{value or "(none — use plain <figcaption>)"}
code_inline: .{value or "(none — use plain <code>)"}
code_block: .{value or "(none — use plain <pre><code>)"}
hr: .{value or "(none — use plain <hr>)"}
article_h2: .{value or "(none — use plain <h2>)"}
article_h3: .{value or "(none — use plain <h3>)"}
article_h4: .{value or "(none — use plain <h4>)"}

These classes were extracted from your existing blog posts. Use them verbatim — do
not invent variants. Do not introduce inline CSS for elements that have a class above.
</blog_content_classes>
```

Block emission rules:

- Emit alongside `<existing_theme_context>`, not instead of. Pages still need landing-page class context; posts need both blocks.
- Emit only when `blog_styling` is present AND `content_type='post'`. All other combinations: emit nothing. Do not emit a placeholder or empty block.
- Block is emitted into the same string position the existing `<existing_theme_context>` is emitted into. Concatenate with a newline between blocks.

### 3.2 No runner changes

Per ARCH §18, `lib/brief-runner.ts` is on the cannot-refactor-without-approval list. **This PR does not modify the runner.** The runner already emits `<blog_post_guidance>` for `content_type='post'`. The new `<blog_content_classes>` block is read by the model alongside `<blog_post_guidance>` because both end up in the system prompt.

If during implementation it becomes clear the runner does need to reference the new block explicitly, abort the PR and surface the contradiction. Do not modify the runner inside this spec.

### 3.3 Tests

In `lib/__tests__/build-injection.test.ts`:

- `blog_styling` present + `content_type='post'`: output includes `<blog_content_classes>`
- `blog_styling` present + `content_type='page'`: output does NOT include `<blog_content_classes>`
- `blog_styling` null + `content_type='post'`: output does NOT include `<blog_content_classes>`
- `blog_styling` null + `content_type='page'`: output does NOT include `<blog_content_classes>`
- Bucket value rendering: when a bucket is null, the placeholder `(none — use plain <X>)` is rendered correctly

Integration test using `brief-runner-dummy.ts` (per ARCH §16):

- Full post-mode brief with `blog_styling` produces a system prompt containing both `<existing_theme_context>` and `<blog_content_classes>`

### 3.4 Files touched in PR 3

- `lib/design-discovery/build-injection.ts` — extend `renderCopyExistingInjection`
- `lib/__tests__/build-injection.test.ts` — extend with new tests
- An integration test file using `brief-runner-dummy.ts` (locate and extend)
- `docs/ARCHITECTURE.md` §5 — document `<blog_content_classes>`

---

## 4. Out of scope

- No vision pass (regex-only extraction, matching existing extractor's approach)
- No Playwright in the extractor (stay with `fetch()` footprint)
- No blog-styling-specific visual review (existing visual review already runs on every page including posts)
- No test post written to WP for calibration
- No `new_design` mode work (Kadence sync owns it)
- No `posts` schema changes
- No bulk-upload surface implementation (just the gate hook per §2.5)
- No "Re-train" automation (wizard's existing "Re-extract" is enough)
- No drift detection
- No confidence scores beyond the cross-URL consistency notes

---

## 5. PR ordering

PR 1 → PR 2 → PR 3. Each can land independently:

- After PR 1: operators can extract and save blog_styling. No gate, no injection. Saved data is unused but valid.
- After PR 2: gate fires correctly. Generated blogs without calibration are blocked from publishing, but the model isn't yet told about the calibrated classes. Acceptable interim state.
- After PR 3: full pipeline. Calibrated classes flow into the prompt for post-mode runs.

Land them in sequence as each is ready. Do not land them as a single mega-PR.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Extractor extension breaks existing extraction | `blog_urls` is optional in request body; existing path unmodified |
| Cross-URL consistency produces low-quality merges | Notes surfaced in wizard for operator review; operator can edit class values manually |
| Preflight blocker fires incorrectly | Gated to `copy_existing` + `content_type='post'` + missing `blog_styling`. Tests cover all 4 mode/type combinations. |
| Schema migration drift | `blog_styling` optional in JSONB; no migration; existing rows valid |
| `<blog_content_classes>` block overflows prompt cache | Block is small (~600 chars). Cache boundary unaffected. |
| Operator edits classes to invalid CSS class names | Save validation: regex-shaped check (CSS class name pattern `/^[a-zA-Z_][a-zA-Z0-9_-]*$/`). Reject obviously-invalid input with Zod error. |
| `content_type` field path differs from assumed | PR 3 first task: read `build-injection.ts` to locate the actual context shape. Adjust before writing code. |
| Runner needs to reference the new block explicitly | Abort PR, surface to Steven |

---

## 7. Sections of `docs/ARCHITECTURE.md` updated after this lands

- §5 Site modes — add `blog_styling` sub-key to `extracted_design` description; document `<blog_content_classes>` block as a third design-context output for `copy_existing` + `content_type='post'`

---

## 8. Acceptance criteria

PR 1:
- [ ] `BlogStyling` type and Zod schema added to `lib/copy-existing-extract.ts` and the save route
- [ ] `extractBlogStyling()` fetches up to 3 blog URLs, same-origin (registrable domain) only, extracts class buckets, returns merged result with notes
- [ ] Wizard shows collapsible "Blog styling" section with input fields and review/edit
- [ ] Save persists `blog_styling` to `extracted_design`
- [ ] Vitest tests pass for cross-URL consistency, registrable-domain check, all merge cases
- [ ] `?focus=blog-styling` auto-expands the section
- [ ] No regressions in existing extraction tests

PR 2:
- [ ] `BLOG_STYLE_NOT_CALIBRATED` blocker added to `lib/site-preflight.ts`
- [ ] Gated to `copy_existing` + `content_type='post'` + missing `blog_styling`
- [ ] `lib/error-translations.ts` returns operator-facing copy
- [ ] Inline banner shown on site detail, posts surface, run page when blocker active
- [ ] CTAs disabled with tooltip when blocker active
- [ ] Run page blocks brief start when blocker active
- [ ] Hard gate (no "Continue anyway")
- [ ] Playwright happy path passes (banner → calibrate → banner clears)

PR 3:
- [ ] `renderCopyExistingInjection` emits `<blog_content_classes>` when applicable
- [ ] Conditional on `blog_styling` present AND `content_type='post'`
- [ ] No modifications to `lib/brief-runner.ts`
- [ ] Vitest covers all 4 conditional combinations and null-bucket placeholder rendering
- [ ] Integration test with `brief-runner-dummy` verifies full prompt assembly
- [ ] `docs/ARCHITECTURE.md` §5 updated
