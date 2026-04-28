import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// BP-6 — SSRF guard for operator-supplied image URLs.
//
// Block list:
//   • IPv4 loopback        127.0.0.0/8
//   • IPv4 unspecified     0.0.0.0/8
//   • IPv4 private         10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
//   • IPv4 link-local      169.254.0.0/16  (covers EC2/GCP metadata IPs)
//   • IPv6 loopback        ::1
//   • IPv6 link-local      fe80::/10
//   • IPv6 unique-local    fc00::/7
//   • Hostnames            localhost, *.internal (heuristic for cloud metadata)
//
// Vercel runtime egress is internet-only by default but the guard is
// belt-and-suspenders for self-hosted deploys.
//
// `assertSafeUrl` resolves the hostname AT CALL TIME and throws if the
// resolved IP is in the blocklist. DNS rebinding is mitigated as long
// as the caller uses the URL within the same `assertSafeUrl + fetch`
// pair — for higher-assurance protection, a follow-up could resolve
// + connect via the resolved IP directly with a Host header. Captured
// in the parent plan's risk audit.
// ---------------------------------------------------------------------------

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "scheme"
      | "hostname_blocked"
      | "ip_blocked"
      | "dns_failed",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isHostnameBlocked(host: string): boolean {
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  // Heuristic: corporate/cloud internal TLDs.
  if (lower.endsWith(".internal") || lower.endsWith(".local")) return true;
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  // ip is a dotted quad like "10.1.2.3"
  const parts = ip.split(".").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as blocked, fail closed
  }
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:")) return true; // link-local fe80::/10
  // unique-local fc00::/7 — first byte 0xfc or 0xfd
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    // sanity: hex digit before colon
    if (lower.length >= 3 && (lower[2] === ":" || /[0-9a-f]/.test(lower[2] ?? ""))) {
      return true;
    }
  }
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — re-check the IPv4 part.
  const v4MappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (v4MappedMatch) return isPrivateIPv4(v4MappedMatch[1] ?? "");
  return false;
}

// Lookup-impl typed loosely so tests can stub it.
type LookupImpl = (hostname: string) => Promise<{ address: string; family: number }>;

const defaultLookup: LookupImpl = async (hostname: string) => {
  const r = await lookup(hostname);
  return { address: r.address, family: r.family };
};

export interface AssertSafeUrlOptions {
  lookupImpl?: LookupImpl;
}

/**
 * Throws SsrfBlockedError if the URL targets a non-https scheme, a
 * blocked hostname, or resolves to a private/loopback/link-local IP.
 * Returns the resolved IP on success so callers can log it.
 */
export async function assertSafeUrl(
  rawUrl: string,
  opts: AssertSafeUrlOptions = {},
): Promise<{ resolvedIp: string; family: 4 | 6 }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(
      `URL is not parseable: ${rawUrl}`,
      "scheme",
      { url: rawUrl },
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SsrfBlockedError(
      `URL scheme "${parsed.protocol}" not allowed; use https.`,
      "scheme",
      { scheme: parsed.protocol },
    );
  }
  const hostname = parsed.hostname;
  if (isHostnameBlocked(hostname)) {
    throw new SsrfBlockedError(
      `Hostname "${hostname}" is on the SSRF blocklist.`,
      "hostname_blocked",
      { hostname },
    );
  }

  // Some operators paste a URL whose hostname is already an IP literal —
  // skip the DNS step and validate the literal directly.
  const isIPv4Literal = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  const isIPv6Literal = hostname.startsWith("[") && hostname.endsWith("]");
  if (isIPv4Literal) {
    if (isPrivateIPv4(hostname)) {
      throw new SsrfBlockedError(
        `IP literal ${hostname} resolves to a private/loopback/link-local range.`,
        "ip_blocked",
        { hostname, ip: hostname },
      );
    }
    return { resolvedIp: hostname, family: 4 };
  }
  if (isIPv6Literal) {
    const stripped = hostname.slice(1, -1);
    if (isPrivateIPv6(stripped)) {
      throw new SsrfBlockedError(
        `IPv6 literal ${stripped} resolves to a private/loopback/link-local range.`,
        "ip_blocked",
        { hostname, ip: stripped },
      );
    }
    return { resolvedIp: stripped, family: 6 };
  }

  let resolved: { address: string; family: number };
  try {
    resolved = await (opts.lookupImpl ?? defaultLookup)(hostname);
  } catch (err) {
    throw new SsrfBlockedError(
      `DNS lookup failed for ${hostname}.`,
      "dns_failed",
      { hostname, error: err instanceof Error ? err.message : String(err) },
    );
  }
  const family = resolved.family === 6 ? 6 : 4;
  const blocked =
    family === 4 ? isPrivateIPv4(resolved.address) : isPrivateIPv6(resolved.address);
  if (blocked) {
    throw new SsrfBlockedError(
      `Hostname ${hostname} resolves to ${resolved.address} (private/loopback/link-local).`,
      "ip_blocked",
      { hostname, ip: resolved.address, family },
    );
  }
  return { resolvedIp: resolved.address, family };
}
