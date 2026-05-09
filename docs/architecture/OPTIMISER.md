# Optimiser module

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Optimiser module".

Lives on `feat/optimiser`. The Autonomous Landing Page Optimisation Engine — an internal Opollo tool that analyses Google Ads landing pages, scores alignment, and produces optimisation proposals. Spec: `docs/Optimisation_Engine_Spec_v1.5.docx`.

## Namespacing rules — strict

- Routes only under `/optimiser/*` and `/api/optimiser/*`. Don't add optimiser logic to `/admin/*` or `/api/cron/*` outside the optimiser module.
- DB tables prefixed `opt_*`. Migrations append-only and numbered sequentially after the latest.
- Module-private code under `lib/optimiser/`, `components/optimiser/`, and `skills/optimiser/`. Outside callers import from `@/lib/optimiser` only — never from a sub-path.
- Existing Site Builder code outside the module is read-only. The one allowed exception is `CLAUDE.md`. If you find yourself wanting to edit `middleware.ts`, `lib/auth.ts`, or any non-optimiser route or lib, stop and reroute the design through the module boundary.

## Inherited surfaces

The optimiser reuses the existing Site Builder's auth (Supabase + role gates via `lib/admin-gate.ts`), the Site Builder generation engine (M12/M13 — Phase 1.5+), `site_conventions`, the WordPress connector (indirectly, via the Site Builder), page versioning, the cron runner under `/api/cron/*`, and the transactional email provider (TBC during Slice 6). Don't build parallel infrastructure for any of these.

## Credential encryption

`opt_client_credentials` uses the same AES-256-GCM + `OPOLLO_MASTER_KEY` pattern as `site_credentials` (see `lib/encryption.ts`). The spec's reference to Supabase Vault is satisfied by the existing project-level master-key contract; deferring to Vault would split the chain of custody for credential encryption.

## Phase 1 done = six PRs merged into `feat/optimiser`

Slice 1 (foundation) → Slice 2 (data ingestion) → Slice 3 (onboarding) → Slice 4 (page browser + healthy state) → Slice 5 (alignment scoring + playbooks + proposals) → Slice 6 (review UI + memory + emails + change log). Don't merge `feat/optimiser` into `main` without Steven's go-ahead.
