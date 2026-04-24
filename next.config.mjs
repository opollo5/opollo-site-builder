import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

// Bundle analyzer: enabled only when ANALYZE=true is set (i.e., via
// `npm run analyze`). In production / CI / dev it's a no-op wrapper
// so we pay zero runtime cost.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// ---------------------------------------------------------------------------
// M9 — Next.js 14.2.35 CVE posture.
//
// Five high-severity advisories affect our vulnerable range (see
// docs/SECURITY_NEXTJS_CVES.md for the full exposure matrix). The
// patches shipped only in next@16.2.4+; no 14.x patch release exists.
// M9's strategy is to keep the code on 14.2.35 (avoiding the multi-
// day 14→16 migration cascade) while explicitly closing the reachable
// configuration surfaces.
//
// Hardening applied here:
//
//   - `images.remotePatterns` is explicitly empty. GHSA-9g9p-9gw9-jx7f
//     (self-hosted Image Optimizer DoS via remotePatterns) requires an
//     operator-configured remote pattern we're serving on. With an
//     empty list, Next.js refuses any remote image optimization
//     request — the advisory's attack vector simply has nothing to
//     exercise.
//
//   - `images.unoptimized: true` disables the `/_next/image` pipeline
//     entirely, closing GHSA-3x4c-7xq6-9pq8 (unbounded disk cache
//     growth). We don't use `<Image>` anywhere in the codebase; this
//     double-locks the surface so a future import doesn't reopen it
//     without a deliberate config change.
//
//   - No `rewrites()` is declared. GHSA-ggv3-7p47-pfv8 (HTTP request
//     smuggling in rewrites) has no attack surface without at least
//     one rewrite rule. The ESLint+CI guard against adding one is a
//     reviewer responsibility — documented in
//     docs/SECURITY_NEXTJS_CVES.md.
//
// The two RSC-related advisories (GHSA-h25m-26qc-wcjf,
// GHSA-q4gf-8mx6-v5v3) are platform-layer mitigations on Vercel; see
// the security doc for the exposure + why self-hosted risks don't
// apply to our deployment.
// ---------------------------------------------------------------------------

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // M9: no remote image optimization. Explicitly empty so the
    // config layer — not just "no caller" — rejects the surface.
    remotePatterns: [],
    // M9: disable /_next/image entirely. We don't use <Image>, and
    // this closes the unbounded-disk-cache advisory at config level.
    unoptimized: true,
  },
  experimental: {
    outputFileTracingIncludes: {
      "/api/chat": ["./docs/SYSTEM_PROMPT_v1.md"],
    },
    // M12-4: playwright-core is a very large node-only package that
    // webpack cannot bundle cleanly — it contains non-JS assets in its
    // vendored recorder UI that the webpack loader graph trips over.
    // Mark it as an external server package so it loads at runtime via
    // Node's require, not the webpack bundle. visual-review.ts only
    // reaches playwright-core through `await import("playwright-core")`
    // inside defaultVisualRender; tests inject a stub render fn so the
    // import is never evaluated at test time.
    serverComponentsExternalPackages: ["playwright-core"],
  },
};

// M10: wrap with Sentry. No-op during builds without SENTRY_AUTH_TOKEN
// (source-map upload skipped); runtime SDK still loads when SENTRY_DSN
// is set via instrumentation.ts.
const withSentry = (cfg) =>
  withSentryConfig(cfg, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.SENTRY_AUTH_TOKEN,
    // Tunnel Sentry requests through a Next.js route to bypass
    // ad-blockers. Not critical for an admin app; keep default off.
    tunnelRoute: undefined,
    widenClientFileUpload: true,
    hideSourceMaps: true,
    webpack: {
      // Replaces the deprecated top-level `disableLogger` /
      // `automaticVercelMonitors` options (removed in a future release).
      removeDebugLogging: true,
      automaticVercelMonitors: false,
    },
  });

export default withSentry(withBundleAnalyzer(nextConfig));
