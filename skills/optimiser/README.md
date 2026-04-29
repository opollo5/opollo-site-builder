# Optimiser skills

Skills (per spec §13) used by the Autonomous Landing Page Optimisation Engine.
Each skill is a folder containing a `SKILL.md`. Slices add the skill body as
they ship; Slice 1 ships the folder scaffolds + the inventory below.

## Phase 1 set

| Skill | Purpose | Slice |
| --- | --- | --- |
| `ads-data-reading` | GAQL query patterns, normalisation, pagination, retry | 2 |
| `clarity-data-reading` | Clarity Data Export API patterns, daily aggregation | 2 |
| `ga4-data-reading` | GA4 Data API dimension/metric pairings, per-page rollups | 2 |
| `pagespeed-reading` | PSI API patterns, Core Web Vitals extraction, weekly cadence | 2 |
| `alignment-scoring` | Rules + LLM hybrid keyword↔ad↔page scoring (§8) | 5 |
| `confidence-calculation` | Four-factor confidence score per §9.4.1 | 5 |
| `playbook-execution` | Evaluate playbook trigger + run fix template | 5 |
| `proposal-generation` | Assemble proposals: priority, evidence, risk, expiry | 5 |
| `page-content-analysis` | Extract H1/H2/CTA/offer from rendered HTML | 5 |
| `healthy-state-evaluation` | Evaluate §9.9 healthy criteria, transition states | 4 |
| `client-memory-application` | Read per-client memory, bias proposals, suppression | 6 |

## Phase 1.5 / 2 / 3 (deferred)

| Skill | Phase |
| --- | --- |
| `staged-rollout-monitoring` | 1.5 |
| `variant-generation` | 2 |
| `playbook-calibration` | 2 |
| `pattern-extraction` | 3 |
| `pattern-application` | 3 |

## Convention

A skill folder's `SKILL.md` is the body Claude Code reads when the skill is
invoked. Helper scripts and templates live alongside in the same folder.
Skills are self-contained — adding a new skill requires no changes
elsewhere in the repo.
