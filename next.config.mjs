/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/chat": ["./docs/SYSTEM_PROMPT_v1.md"],
    },
  },
};

export default nextConfig;
