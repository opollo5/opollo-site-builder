# Pattern — Assistive operator flow

## When to use it

Any new admin UI, chat flow, site-setup step, or error surface that an operator interacts with. The operator is not a WordPress / Supabase / Kadence / deployment expert. This pattern is the playbook for keeping the product honest to that assumption — and it's the reason a slice shipped with raw 403s, silent publishes, or jargon tooltips is a review blocker, not a polish follow-up.

Don't use for: internal ops surfaces only an engineer sees (cron probes, health endpoints, maintenance scripts). If no operator reads it, save the effort.

## The principle

Detect what we can detect. Explain what we can't. Never fail late. Never publish silently. Every error message tells the operator the next action, not just what went wrong.

## Required touchpoints

Every operator-facing surface should either tick each box below or state explicitly in the PR description why it's skipped. "Skipped — this modal is engineer-only" is fine; silent omission is not.

### Preflight — detect + warn at setup time, never at action time

- **Capability checks.** If the action will need a WordPress capability, an external API scope, or an installed plugin, verify at site-registration or feature-enable time — not at the moment the operator presses the button. Example: `GET /wp-json/wp/v2/users/me` at site registration so a missing `publish_posts` cap surfaces as "Your WordPress user needs Editor role or higher" before the operator tries to publish a post.
- **Plugin / theme detection.** If behaviour branches on what's installed on the client site (SEO plugin, theme family, image-size presets), detect and persist the detection on the site row. Re-probe on a schedule or on-demand; don't assume the first answer is permanent.
- **Config completeness.** Any required env var that's allowed to be absent must degrade gracefully and label itself as degraded in the admin UI (see Sentry / Axiom / Langfuse pattern from M10).

### In-flow — confirmations that teach, not bureaucratise

- **Draft-by-default.** Every new-content action stages a draft first; publishing is an explicit second step. State this to the operator the first time they enter the flow, not the fifth.
- **Say where meta is going.** When the slice writes to a plugin-specific field (Yoast's `_yoast_wpseo_metadesc`, Rank Math's `rank_math_description`), the flow tells the operator which plugin was detected and which field will receive the value. If none is detected, surface a fallback + recommend installing one.
- **Surface creation side-effects.** If Claude is about to create a category, tag, media item, or any taxonomy row, name the row being created before the click. "I'll create a new category called 'Product Updates'. OK?" beats a silent POST.
- **Featured-image parity.** If the surface expects an image and one is missing, ask — don't default to blank. "No featured image selected — pick from the library, skip, or suggest one?"

### Admin UI — jargon-free on the surface, precise on hover

- **Every WordPress / database-idiom label gets a one-line ⓘ tooltip.** Slug, Excerpt, Featured image, Category, Tag, Status, Version lock, Design system version. Plain English. No docs link required to understand.
- **Status pills are unambiguous.** Draft / Scheduled / Published / Failed / Archived. Each status has a next-action affordance where applicable ("Preview", "Publish", "View error").
- **Empty states teach.** First-run / zero-row states include a one-sentence explanation of what will appear here and the CTA that populates it.

### Error messages — translate the protocol, name the next action

- **No raw status codes, no raw database errors.** 403 → "This WordPress user can't create categories. Ask the client to raise the user's role." 23505 → "A post with this URL already exists — try 'my-post-2' or reuse the existing one." Image upload > 10MB → "The image is larger than this site allows. Resize or pick another."
- **Every error names the next action.** Not "VALIDATION_FAILED" but "Slug must be lowercase letters, numbers, and hyphens only. Try 'my-post-title'."
- **Every error preserves what the operator wrote.** Form re-renders with their input intact so a 400 isn't a "start over" event.

### Destructive / billing actions — confirm with consequence, not with "OK"

- **Publish, unpublish, delete, bulk-regenerate, archive, restore** all get a confirm step that names the consequence in one sentence. "This will publish the post at example.com/blog/my-post. Visible to the public immediately."
- **Billing actions** ("Re-generate page", "Batch-generate 40 pages", "Run brief") confirm the estimated cost + current budget remaining before the call goes out. Reuse the M8 budget preview.

## Scaffolding

### Preflight capability check — template

A preflight is a single function that takes a site row, hits the external dependency, and returns a structured result the admin UI renders as a readiness panel:

```ts
// lib/site-preflight.ts
export interface Preflight {
  ok: boolean;
  capabilities: Record<string, boolean>;
  warnings: Array<{ code: string; message: string; hint: string }>;
  blockers: Array<{ code: string; message: string; hint: string }>;
}

export async function preflightSiteForPosts(siteId: string): Promise<Preflight> {
  // 1. GET /wp-json/wp/v2/users/me to list the app-password user's caps.
  // 2. Probe /wp-json to list active plugins (for SEO plugin detection).
  // 3. Probe the active theme.
  // 4. Map every result to a { ok, message, hint } envelope.
}
```

The admin UI renders `Preflight` as a readiness card on the site detail page. Blockers prevent the feature being used on that site; warnings surface as yellow notices but don't block.

### Error translation — template

Central translation layer, not scattered `switch` blocks per component. Introduced in M13 alongside this pattern; subsequent milestones extend the table rather than forking it:

```ts
// lib/error-translations.ts
export const ERROR_TRANSLATIONS: Record<string, (ctx: ErrCtx) => TranslatedError> = {
  WP_403_CAP_MISSING: (ctx) => ({
    title: "WordPress permission denied",
    body: `This site's WordPress login can't ${ctx.action}.`,
    hint: "Ask the client to raise the user's role to Editor or Administrator.",
  }),
  POST_SLUG_CONFLICT: (ctx) => ({
    title: "That URL is already used",
    body: `A post at ${ctx.siteUrl}/${ctx.slug} already exists.`,
    hint: `Try '${ctx.slug}-2' or open the existing post to edit it instead.`,
  }),
  // …
};
```

Every route and tool executor routes errors through `translateError(code, ctx)` before surfacing to the operator. Raw codes are only logged, never rendered.

### Tooltip — reuse existing

Use the shadcn `<Tooltip>` component already in `components/ui/tooltip.tsx`. Standard label shape:

```tsx
<Label htmlFor="slug" className="flex items-center gap-1">
  URL slug
  <Tooltip>
    <TooltipTrigger asChild><InfoIcon className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
    <TooltipContent>The short URL for this post — lowercase, hyphens only.</TooltipContent>
  </Tooltip>
</Label>
```

One line per tooltip. If it needs a paragraph, the label is wrong.

## Required tests

1. **Preflight happy path + every documented blocker and warning.** Each `blockers[]` code gets a test that seeds the bad state and asserts the preflight surfaces it before the action is reachable.
2. **Every error code surfaces through `translateError()`.** Unit test per new code asserts `{ title, body, hint }` are all present and non-empty.
3. **Destructive-action confirmation.** E2E test opens the action's confirm modal and asserts the consequence sentence is present before the click lands.
4. **E2E spec drives a naive-operator path.** At least one spec per feature walks the "operator has never used WordPress" flow and asserts no field is unexplained — every label has a visible ⓘ tooltip or plain-English sub-label.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). The **"Risks identified and mitigated"** section additionally names which operator surfaces the slice touches and which touchpoints from this pattern were applied vs deliberately skipped.

## Known pitfalls

- **Failing at action time instead of setup time.** An operator who's told "403 — insufficient privileges" at the click has already invested seconds of attention; the same message at site registration is a one-time cost. Preflight is cheap.
- **Echoing the error code as the error message.** "WP_403_CAP_MISSING" rendered to an operator is the same as rendering nothing. Route everything through `translateError()`.
- **Tooltip that restates the label.** "Slug: the slug" is noise. A useful tooltip answers "what goes here and what format is expected."
- **Confirm dialog that doesn't name the consequence.** "Are you sure?" is not a confirm — name the effect ("This makes the post public at <url>").
- **Silent fallback when a dependency is missing.** If the SEO plugin is missing, don't silently write the meta description into the post excerpt and move on. Surface the fallback explicitly.
- **Per-component error switch blocks.** Duplicated translation logic drifts — one route updates its copy, another doesn't. Central table or nothing.
- **Preflight that caches forever.** Capabilities and plugins change on the client side. Re-probe on a schedule or on explicit operator request; never treat a single success as permanent.

## Pointers

- Related patterns: [`new-admin-page.md`](./new-admin-page.md), [`new-api-route.md`](./new-api-route.md), [`ship-sub-slice.md`](./ship-sub-slice.md).
- Translation table lives in `lib/error-translations.ts` (extend; don't fork).
- Preflight example shipped: `lib/health-checks.ts` (M10 / M11-7), WP credential probe in the site-registration route.
