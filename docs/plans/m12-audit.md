# M12 — Capability Audit

## STATUS: superseded

This is an overnight session artifact describing a 7-slice A–G split that is NOT the canonical M12 plan. See `docs/plans/m12-parent.md` for the canonical 6-slice split (M12-1 through M12-6). The capability-mapping evidence below is still useful background — the slice-ordering and table-layout prescriptions are not. Preserved as history; do not execute against.

---

Phase 1 of the overnight autonomous M12 build. Reads actual source (not plan docs) for each of the 18 capabilities the overnight prompt names, classifies each as **exists-reuse**, **exists-extend**, or **absent-build-new**, and names the concrete file(s).

**Basis:** origin/main @ `29a89ac`, read on branch `claude/m12-00-reconcile` after Phase 0.

## Capability table

| # | Capability | Concrete location | State | M12 verdict |
| --- | --- | --- | --- | --- |
| 1 | Site theme / DS extraction | `lib/design-systems.ts`, `lib/design-system-prompt.ts`, migrations `0002_m1a` + `0003_m1b` | Authoring-side exists; extract-from-existing-site absent | Slice A writes new `lib/theme-extractor.ts`; output target is existing `design_systems` schema |
| 2 | Single-page generation | `lib/regeneration-worker.ts`, `lib/regeneration-publisher.ts` (M7) | Single-pass exists | Slice C wraps M7's call shape in multi-pass loop |
| 3 | Multi-pass (draft → critique → revise) | Absent | None | Slice C new; promote to `docs/patterns/multi-pass-runner.md` on first reuse |
| 4 | Playwright runtime worker | `playwright.config.ts`, `e2e/*.spec.ts`, Lighthouse CI | Test-time only | Slice E new `lib/visual-render.ts`; Vercel runtime constraints noted |
| 5 | Claude visual critique (multi-modal) | `lib/anthropic-caption.ts` (M4-4 image → caption) | Call shape exists; critique-into-revise loop absent | Slice E extends caption helper into `lib/anthropic-visual-critique.ts` |
| 6 | Sequential runner with lease/heartbeat | `lib/batch-worker.ts`, `lib/regeneration-worker.ts` | Pattern exists; concurrency=1-per-brief shape is new | Slice D reuses lease/heartbeat; new partial unique index on `brief_runs (brief_id) WHERE status='running'` |
| 7 | Resume-after-crash | `lib/batch-worker.ts`, `lib/regeneration-worker.ts`, `batch-worker-retry.test.ts` | Exists | Slice D pattern-reuse + per-pass pointers on `brief_pages` |
| 8 | Budget enforcement + per-run $ ceilings | `lib/tenant-budgets.ts` (`reserveBudget`) | Tenant-level exists; per-run worst-case absent | Slice D extends M8 with `reserveWithCeiling()` |
| 9 | Langfuse tracing | `lib/langfuse.ts` (`traceAnthropicCall`), wired in batch + regen workers | Exists | Slices C/D/E wrap every Anthropic call in `traceAnthropicCall`; brief body redacted via new `lib/pii-redact.ts` |
| 10 | RLS + PII handling | `supabase/migrations/0005_m2b_rls_policies.sql`, `lib/supabase.ts` | RLS matrix exists; PII-redact helper absent | Slice B migration mirrors M2b; new `lib/pii-redact.ts` |
| 11 | Publish surface from generator output | `lib/regeneration-publisher.ts` (M7), `lib/batch-publisher.ts` (M3) | Exists | Slice F publish button reuses M7's publisher; no new publish code |
| 12 | Operator review/approval UI | `app/admin/sites/[id]/pages/[pageId]/page.tsx` (M6), `EditTenantBudgetButton.tsx` (M8) | List + detail + VERSION_CONFLICT patterns exist; review-between-pages state machine absent | Slice F new `/admin/sites/[id]/briefs/[briefId]/run` following `new-admin-page.md` |
| 13 | Prompt caching | `cache_control` ephemeral blocks in `lib/batch-worker.ts`, `regeneration-worker.ts`, `anthropic-caption.ts`, `app/api/chat/route.ts` | Exists | Slice C attaches `cache_control` to `<brief_document>` + `<site_conventions>` prefix |
| 14 | Idempotency keys on worker jobs | `anthropic_idempotency_key` + `wp_idempotency_key` on M3 + M7 schemas | Exists | Slice B adds `upload_idempotency_key` on `site_briefs`; Slice D adds per-pass keys `(brief_id, page_ordinal, pass_kind, pass_number)` |
| 15 | Admin routes / auth | `middleware.ts`, `lib/admin-gate.ts`, `lib/admin-api-gate.ts` | Exists | New M12 routes go through `admin-api-gate`; pages through `admin-gate` |
| 16 | File upload (text + Markdown) | Absent | None | Slice B new `POST /api/sites/[id]/briefs` — multipart, streams to Supabase Storage under `site-briefs/` |
| 17 | Document parsing | Absent | None | Slice B new `lib/brief-parser.ts` — structural-first, Claude-inference fallback with source-quote citations |
| 18 | Per-site config / feature flags | `lib/system-prompt.ts` (`FEATURE_DESIGN_SYSTEM_V2`), `middleware.ts` (`FEATURE_SUPABASE_AUTH`), `opollo_config` table (M2a) | Exists | Slice G's PDF/.docx stretch gated on `FEATURE_BRIEF_PDF_PARSER` per `feature-flagged-rollout.md` |

## Summary

- **4 capabilities purely new** (#3, #4, #16, #17).
- **6 capabilities extend** existing code (#1 extractor, #2 single-page, #5 visual critique, #6 concurrency, #8 ceiling budgets, #12 review UI).
- **8 capabilities pure reuse** (#7, #9, #10, #11, #13, #14, #15, #18).

No ambiguous "parallel infrastructure" candidates per the overnight decision rule (>60% exists → extend, <30% → new). Slice dependencies and ordering are in `docs/plans/m12-reconciliation.md`; this doc's job is to ground the slice plan in actual-source evidence.

## Audit-surfaced adjustments to the reconcile-PR slice plan

- **Slice B** adds `site_briefs.upload_idempotency_key` (capability #14 pattern applies to uploads, not only to Anthropic calls) and surfaces the 60k-input-token size cap at upload time as `BRIEF_TOO_LARGE`.
- **Slice A** does not need a new table — writes through `lib/design-systems.ts` into existing `design_systems` / `design_components`.
- **Slice D** folds in the `reserveWithCeiling()` M8 extension (one tiny function add, per overnight's "don't build parallel infrastructure" rule).
- **Slice E** flags Playwright-on-Vercel runtime constraint (serverless browser limits). Documented in Slice E's PR description. Does not block slice merge; does block production rollout.
- **Slice G** promotes two patterns: `multi-pass-runner.md` and `visual-critique-loop.md`.
