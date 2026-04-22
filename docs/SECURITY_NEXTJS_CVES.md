# Next.js 14.2.35 — CVE exposure + mitigation matrix

**Status as of M9 (#TBD merged 2026-04-22):** `next@14.2.35` is our pinned version. None of the five open advisories have a 14.x patch release; fixes shipped only in `next@16.2.4+`. The 14→16 migration is tracked as a post-M9 candidate in `docs/BACKLOG.md` (multi-day effort: middleware Supabase cookie-refresh API changed, `params`/`searchParams` became Promises in 15.x, CSP nonce APIs shifted, Radix/React/ESLint cascade).

M9 closes the reachable configuration surfaces on 14.2.35 rather than forcing the migration before vendor / schema-hygiene work Steven has queued. The exposure matrix:

---

## 1. GHSA-ggv3-7p47-pfv8 — HTTP request smuggling in rewrites

**Severity:** moderate
**Fixed in:** next@16.2.4
**Our exposure:** NONE.
**Why:** `next.config.mjs` declares no `rewrites()` function. The advisory requires at least one rewrite rule to exercise. `grep -r "rewrites" next.config.mjs` returns zero matches.
**Mitigation:** Config-level — no rule, no surface. Reviewer responsibility: any PR that adds `rewrites()` must be audited against this CVE before merge. When the 14→16 migration lands, this advisory becomes moot.

---

## 2. GHSA-9g9p-9gw9-jx7f — Image Optimizer remotePatterns DoS (self-hosted)

**Severity:** moderate
**Fixed in:** next@16.2.4
**Our exposure:** NONE.
**Why:** two reasons, each sufficient:
  1. `next.config.mjs` sets `images.remotePatterns: []` explicitly. Next.js refuses any remote image optimization request with an empty allowlist.
  2. We don't use `<Image>` anywhere — `grep -r "next/image" components/ app/ lib/` returns only `middleware.ts:265` (the `_next/image` matcher exclusion, which is unrelated to the CVE).
**Mitigation:** `remotePatterns: []` in `next.config.mjs`. Double-locked by `images.unoptimized: true` below.

---

## 3. GHSA-3x4c-7xq6-9pq8 — next/image unbounded disk cache growth

**Severity:** moderate
**Fixed in:** next@16.2.4
**Our exposure:** NONE.
**Why:** `<Image>` is not imported anywhere in the codebase. Even if a future PR added one, `images.unoptimized: true` disables the `/_next/image` optimization pipeline — the advisory's cache layer doesn't exist on our deployment.
**Mitigation:** `images.unoptimized: true` in `next.config.mjs`.

---

## 4. GHSA-h25m-26qc-wcjf — React Server Components HTTP request deserialization DoS

**Severity:** high
**Fixed in:** next@16.2.4
**Our exposure:** PARTIAL.
**Reachable on:** every Server Component, including public ones (`/`, `/login`, `/logout`, `/auth-error`) and authenticated ones (the entire `/admin/*` surface).
**Why the exposure is bounded on our deployment:**
  1. **We run on Vercel, not self-hosted.** The Next.js security team's advisories note platform-layer mitigations: Vercel applies request-shape filtering at the edge that rejects the specific malformed payloads this CVE exploits before they reach the function runtime. This doesn't make the CVE "fixed" in our `next` version, but it removes the attack vector for our production surface.
  2. **Public RSC routes are narrow.** `/` is behind auth when `FEATURE_SUPABASE_AUTH=on`; `/login` / `/logout` / `/auth-error` are small pages with minimal Server Component logic — no expensive downstream calls to amplify a DoS payload into resource exhaustion.
  3. **Admin RSC routes are gated** by `middleware.ts` + `checkAdminAccess()` with Supabase session validation. An unauthenticated attacker can't reach them at all.
**Mitigation applied:** None at config level — the fix is a Next.js runtime change that's only in 16.x. Relying on (1) platform mitigation + (2) bounded surface. If we move to self-hosted, this escalates to blocking.
**Review gate before self-hosting:** re-evaluate before any deployment target change.

---

## 5. GHSA-q4gf-8mx6-v5v3 — Server Components DoS

**Severity:** high
**Fixed in:** next@16.2.4
**Our exposure:** PARTIAL (same as #4).
**Reachable on:** same RSC surfaces.
**Why the exposure is bounded:** identical reasoning to GHSA-h25m-26qc-wcjf — Vercel platform mitigation + narrow public RSC + admin gate on everything else.
**Mitigation applied:** None at config level. Same platform-level dependency.
**Review gate:** same.

---

## `npm audit` threshold

`.github/workflows/audit.yml` threshold stays at `critical` for now. Tightening to `high` requires the 14→16 migration to land. That milestone is tracked in `docs/BACKLOG.md` as "M10-candidate: Next.js 14→16 migration."

## What to check if any of these numbers change

- A new PR adds `rewrites()`, `<Image>` usage, or `images.remotePatterns` → re-read the corresponding advisory.
- We move off Vercel → CVEs 4 + 5 escalate from "platform-mitigated" to "actively exposed." Block self-hosting until 16.x migration ships.
- A sixth Next.js CVE surfaces → add a section here and update the matrix.

## Links

- [GHSA-9g9p-9gw9-jx7f](https://github.com/advisories/GHSA-9g9p-9gw9-jx7f)
- [GHSA-h25m-26qc-wcjf](https://github.com/advisories/GHSA-h25m-26qc-wcjf)
- [GHSA-ggv3-7p47-pfv8](https://github.com/advisories/GHSA-ggv3-7p47-pfv8)
- [GHSA-3x4c-7xq6-9pq8](https://github.com/advisories/GHSA-3x4c-7xq6-9pq8)
- [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3)
