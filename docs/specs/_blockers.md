# Spec run blockers

Surfaced by the autonomous spec runner. Each entry: which spec/PR, the
contradiction encountered, and the chosen interim behaviour.

## Spec 03 PR 3 — content_type gating without modifying brief-runner.ts

**Date:** 2026-05-07

**Spec section in tension:** Spec 03 §3.1 + §3.2.

- §3.1 requires `<blog_content_classes>` to emit only when `content_type='post'`.
- §3.2 says "This PR does not modify the runner" (per ARCH §18, `lib/brief-runner.ts` is on the cannot-refactor list).

**Reality on disk:**

- The runner calls `buildDesignContextPrefix(brief.site_id)` at `lib/brief-runner.ts:2004` — siteId only, no content_type, no `ctx` parameter.
- The spec's diagnostic ("`ctx.brief.content_type` mirrors the pattern at brief-runner.ts:656-661") didn't match the actual signature. The spec author wrote "If different, use the actual path and adjust this spec's wording" but also wrote "this PR does not modify the runner" — these instructions disagree when the only non-runner-touching path requires adding a DB read inside the helper.

**What this PR did:**

- Added optional `contentType?: 'post' | 'page'` parameter to `buildDesignContextPrefix()` and `renderInjection()`.
- Added the `<blog_content_classes>` block emission gated on `contentType === 'post'` AND `extracted_design.blog_styling` having usable data.
- **Did NOT modify `lib/brief-runner.ts:2004`.** The call site still passes only `siteId`. Result: with current main, the new block never emits — the helper extension is ready-to-activate but inert.

**To activate:** change `lib/brief-runner.ts:2004` from

```ts
const designContextPrefix = await buildDesignContextPrefix(brief.site_id);
```

to

```ts
const designContextPrefix = await buildDesignContextPrefix(
  brief.site_id,
  brief.content_type,
);
```

That single-line change is gated on Steven's explicit approval per ARCH §18.

**Why this is acceptable interim state:**

- All vitest tests for the helper still pass (they exercise both the gated and ungated paths via the optional parameter).
- No runtime regression: existing callers' behaviour is unchanged.
- PR 1 (extraction) + PR 2 (preflight gate) of Spec 03 still deliver value: operators can calibrate, gate fires at publish time. The third leg (model receives the calibrated classes) waits on Steven's approval to thread the parameter.
