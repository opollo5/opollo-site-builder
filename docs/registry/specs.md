# Spec Registry

Numbered post-M16 specs. Each spec is an autonomous-build brief scoped to a single
coherent deliverable. The spec file is the single source of truth for requirements;
the run log records what shipped.

## Status key

`shipped` — all PRs merged to main  
`partial` — some PRs merged, remainder documented in `docs/specs/_blockers.md`  
`active` — currently in-flight  
`queued` — brief written, not yet started  
`gap` — number reserved but no brief written yet

---

| # | Slug | Brief | Status | PRs | Notes |
|---|---|---|---|---|---|
| 01 | sites-admin-cleanup | `docs/specs/01-sites-admin-cleanup.md` | shipped | #732 | Rename, Connect link, sort+filter, purge |
| 02 | page-header-typography | `docs/specs/02-page-header-typography.md` | shipped | #740 #741 #742 #744–#750 | Full sweep including Spec 04 drain; optimiser routes still out of scope (blocked on feat/optimiser merge) |
| 03 | blog-styling-calibration | `docs/specs/03-blog-styling-calibration.md` | shipped | #735 #736 #739 #785 | Injection activated in brief-runner.ts #785 (2026-05-08) |
| 04 | page-header-sweep | — | shipped | #744–#750 | Drained `PAGE_HEADER_DEFERRED_ROUTES` to `[]`; optimiser routes deferred pending feat/optimiser merge |
| 05 | images-suggest | — | shipped | #752 #753 #754 #756 | Picker debounce + vector array fix + bounded fetches + empty state |
| 06 | platform-keyboard-shortcuts | — | shipped | #755 | usePlatform + Kbd primitive + sweep |
| 07 | content-preview | — | shipped | #758 #760 | PR A: empty-state fix; PR B: loading-button sweep |
| 08 | success-moments | `docs/specs/08-success-moments.md` | shipped | #762 #774 #776 #782 | Primitives + surface sweep + tier-1 adoption + toast standardisation |
| 09 | image-filename-alt-text | — | shipped | #757 | SEO-friendly filenames + alt text on WP publish |
| 10 | composer-sidebar-panel | — | gap | — | Referenced as Spec 11 dependency; resolved in-band without a formal spec |
| 11 | yoast-seo-panel | — | shipped | #778 | Google preview first, length bars, slug inline |
| 12 | composer-typography | — | shipped | #779 | 40px title, 18px body, 800px column |
| 13 | composer-right-column | — | gap | — | Referenced as Spec 12 dependency; resolved in-band without a formal spec |
| 14 | session-expiry | — | shipped | #763 #772 #773 #775 | Warning modal + grace period + hard-logout + /auth/expired page |
| 15 | platform-status-and-docs-reorg | — | shipped | #766 | Docs reorganisation into category subdirectories |
| 16–17 | — | — | gap | — | Reserved |
| 18 | data-table | — | shipped | #767 #768 #769 #770 | Canonical DataTable primitive + all admin tables migrated |
| 19–21 | — | — | gap | — | Reserved |
| 22 | social-composer | — | queued | — | Phase 1 social composer; ADRs 0001–0004 written (Week 0); brief not yet written |
| 23 | pre-expiry-warnings | — | queued | — | Pre-expiry connection warning banner + notifications; FEATURE_PRE_EXPIRY_WARNINGS gates |

## Gap note

Spec numbers 10 and 13 were absorbed into adjacent specs without formal briefs.
Spec numbers 16–17 and 19–21 are reserved for future use.

## Related files

- `docs/specs/_run-log.md` — autonomous-run session log (what shipped per run)
- `docs/specs/_blockers.md` — spec blockers and interim deviations
- `docs/feature-flags.md` — feature flags for social composer workstream
- `docs/adrs/` — architectural decision records (ADR 0001–0004 for social composer)
