# M9 — Next.js 14.2.35 CVE Mitigation (retroactive)

## Status

Shipped in a single-PR hybrid (#84). Backfilled during M11-6 (audit close-out 2026-04-22) for pattern consistency with other milestones.

## What it is

Pin the in-use Next.js version at 14.2.35 (the last `.x` that ships CVE mitigations for the 14.2 line) + lock down `next.config.mjs` so the three reachable CVEs close at the config level without code changes. The two RSC CVEs that stay "partial" remain platform-mitigated on Vercel (our only deploy target).

## Scope (shipped in M9)

- **`package.json`** declares `"next": "^14.2.15"`; `package-lock.json` pins `node_modules/next` to `14.2.35`. Running `npm ci` (which CI uses) installs the pinned version exactly.
- **`next.config.mjs`** — `images.remotePatterns: []` + `images.unoptimized: true` + no `rewrites()`. Closes:
  - GHSA-9g9p-9gw9-jx7f (rewrites smuggling — unreachable because we declare no rewrites)
  - GHSA-3x4c-7xq6-9pq8 (Image Optimizer DoS — unreachable because images.unoptimized=true)
  - GHSA-ggv3-7p47-pfv8 (next/image disk cache — same, Image Optimizer disabled)
- **`docs/SECURITY_NEXTJS_CVES.md`** — full exposure matrix with per-CVE reasoning for every advisory in the 14.2 line. Two remaining RSC CVEs (GHSA-h25m-26qc-wcjf, GHSA-q4gf-8mx6-v5v3) documented as platform-mitigated and flagged as blockers for self-hosting.
- **`.github/workflows/audit.yml`** threshold stays at `critical` (blocks merges on critical CVEs only). Trigger for tightening to `high` is the pending 14 → 16 migration.

## Out of scope

- **Next.js 14 → 16 migration.** Tracked in BACKLOG as "M10-candidate: Next.js 14 → 16 migration." Upgrade has non-trivial surface (app-router API changes, middleware signature, `<Image>` behaviour, React 19 peer). Stays a dedicated milestone.
- **Self-hosting.** Not a current or near-term requirement; two CVEs that require self-hosting mitigations stay open in the matrix.

## Env vars required

None new. Config-only change.

## Risks identified and mitigated

1. **`npm install` drifts away from 14.2.35 and picks up a later 14.2.x with a regression.** → `package-lock.json` pins the exact version; `npm ci` (not `npm install`) is what CI uses, so the lock is authoritative. Dependabot will propose upgrades as separate PRs.

2. **A future rewriter is added to `next.config.mjs` without re-auditing.** → `docs/SECURITY_NEXTJS_CVES.md` explicitly calls out the rewrite-smuggling CVE. A reviewer seeing a new `rewrites()` block should cross-check. No code-level enforcement — this is a docs + review contract.

3. **Image Optimizer is re-enabled.** → `images.unoptimized: true` is the kill switch. Re-enabling requires a conscious `next.config.mjs` change that would surface the same class of CVEs. Review-time enforced.

4. **`npm audit` picks up a new critical CVE between merges.** → `.github/workflows/audit.yml` runs on every PR + weekly cron. Blocks on `critical`. Threshold will tighten to `high` once 14 → 16 lands.

5. **CodeQL misses a new SSRF / prototype-pollution surface introduced alongside Next.js upgrades.** → CodeQL runs on every PR and flags these categories directly. M9 is config-only so the surface is small.

6. **Operator deploys to Vercel with a stale `next.config.mjs`.** → Vercel always builds from the repo head; stale config can't ship without a merged PR to main.

## Shipped as a single PR

M9 was not sub-sliced. The config + lock + docs + audit workflow tweak are atomic; breaking into parts would leave the app in a worse intermediate state (e.g. version pinned but config unlocked). Single PR #84.

## Relationship to later milestones

- M10's observability wiring leans on this version pin — Sentry + Langfuse SDKs are compatible with 14.2.35 without additional shims.
- M11 doesn't touch the security posture; the audit close-out treats M9 as pass with no follow-ups until the 14 → 16 migration is scheduled.
