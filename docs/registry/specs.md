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
| 01 | sites-admin-cleanup | `docs/specs/01-sites-admin-cleanup.md` | queued | — | Not yet started |
| 02 | page-header-typography | `docs/specs/02-page-header-typography.md` | partial | #740 #741 #742 | Optimiser routes deferred — see `_blockers.md` |
| 03 | blog-styling-calibration | `docs/specs/03-blog-styling-calibration.md` | partial | #735 #736 #739 | Injection inert until `brief-runner.ts:2004` change approved — see `_blockers.md` |
| 04 | page-header-sweep | — | shipped | #744–#749 | Drained `PAGE_HEADER_DEFERRED_ROUTES` to `[]`; optimiser routes still out of scope |
| 05 | images-suggest | — | shipped | see run-log | Spec 05 work complete |
| 06 | platform-keyboard-shortcuts | — | shipped | #755 | |
| 07 | content-preview | — | shipped | #758 #760 | PR A: empty-state fix; PR B: loading-button sweep |
| 08 | success-moments | `docs/specs/08-success-moments.md` | shipped | #762 | |
| 09 | image-filename-alt-text | — | shipped | #757 | SEO-friendly filenames + alt text on WP publish |
| 15 | platform-status-and-docs-reorg | — | shipped | #759 #761 #763 | PR A: status report; PR B: root cleanup; PR C: this reorg |

## Gap note

Spec numbers 10–14 are not yet assigned briefs. They are reserved for future use.
When a spec brief is written, add a row here and create `docs/specs/NN-slug.md`.

## Related files

- `docs/specs/_run-log.md` — autonomous-run session log (what shipped per run)
- `docs/specs/_blockers.md` — spec blockers and interim deviations
