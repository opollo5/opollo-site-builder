// ---------------------------------------------------------------------------
// Reusable SSRF payload list. Use in route-layer tests where a route
// fetches a user-supplied URL — `admin/images/fetch-url`,
// `tools/search-images`, `optimiser/page-import`,
// `design-discovery/extract-*`.
//
// Each payload represents an attempt to coerce the server into
// fetching an internal-only resource. Drive through `lib/ssrf-guard.ts`
// and assert the guard rejects.
//
// The list is biased toward AWS / Vercel / Supabase edge metadata
// endpoints — those are the highest-impact targets in this codebase.
// ---------------------------------------------------------------------------

export const SSRF_PAYLOADS: Array<{ payload: string; technique: string }> = [
  // AWS instance metadata (IMDSv1).
  {
    payload: "http://169.254.169.254/latest/meta-data/",
    technique: "AWS IMDSv1 metadata",
  },
  // Google / GCP metadata.
  {
    payload: "http://metadata.google.internal/computeMetadata/v1/",
    technique: "GCP metadata",
  },
  // Localhost variants.
  { payload: "http://localhost:5432/", technique: "Postgres on localhost" },
  {
    payload: "http://127.0.0.1:6379/",
    technique: "Redis on loopback",
  },
  { payload: "http://[::1]/", technique: "IPv6 loopback" },
  {
    payload: "http://0.0.0.0/",
    technique: "0.0.0.0 (mac/linux quirks)",
  },
  // Private IP ranges.
  { payload: "http://10.0.0.1/", technique: "RFC1918 10/8" },
  { payload: "http://192.168.1.1/", technique: "RFC1918 192.168/16" },
  { payload: "http://172.16.0.1/", technique: "RFC1918 172.16/12" },
  // file:// scheme.
  {
    payload: "file:///etc/passwd",
    technique: "file:// scheme",
  },
  // gopher:// for older fetcher exploits.
  {
    payload: "gopher://localhost:6379/_INFO",
    technique: "gopher protocol",
  },
  // DNS rebind via decimal IP.
  {
    payload: "http://2130706433/",
    technique: "decimal-encoded 127.0.0.1",
  },
  // Cloud-metadata via @ confusion.
  {
    payload: "http://example.com@169.254.169.254/",
    technique: "userinfo @-prefix to bypass naive host check",
  },
  // Redirect chain to internal target.
  {
    payload: "http://httpbin.org/redirect-to?url=http://169.254.169.254/",
    technique: "open-redirect chain to metadata endpoint",
  },
];

export const SSRF_PAYLOAD_STRINGS = SSRF_PAYLOADS.map((p) => p.payload);
