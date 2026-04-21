import bundleAnalyzer from "@next/bundle-analyzer";

// Bundle analyzer: enabled only when ANALYZE=true is set (i.e., via
// `npm run analyze`). In production / CI / dev it's a no-op wrapper
// so we pay zero runtime cost.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/chat": ["./docs/SYSTEM_PROMPT_v1.md"],
    },
  },
};

export default withBundleAnalyzer(nextConfig);
