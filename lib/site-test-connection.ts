import "server-only";

import { wpGetMe, type WpConfig, type WpError } from "@/lib/wordpress";

// AUTH-FOUNDATION P2.1 — Pre-save WP connection test.
//
// Used by /admin/sites/new and /admin/sites/[id]/edit before save.
// Hits GET /wp-json/wp/v2/users/me?context=edit with Basic auth and
// validates the user has publish capability.
//
// Capability check (any one of these passes):
//   1. roles[] contains 'administrator', OR
//   2. roles[] contains 'editor', OR
//   3. capabilities.publish_posts === true
//
// (1)+(2) are the canonical roles a publishing operator would have.
// (3) is the durable capability check — covers Author or any custom
// role that's been granted publish_posts. We accept any of the three
// so a custom-role environment isn't rejected by a roles-only check.

const PUBLISH_ROLES = new Set(["administrator", "editor"]);

export interface TestConnectionInput {
  url: string;
  username: string;
  app_password: string;
}

export interface TestConnectionUser {
  display_name: string;
  username: string;
  roles: string[];
}

export type TestConnectionResult =
  | { ok: true; user: TestConnectionUser }
  | {
      ok: false;
      error: {
        code:
          | "AUTH_FAILED"
          | "REST_UNREACHABLE"
          | "INSUFFICIENT_ROLE"
          | "NETWORK"
          | "INVALID_URL"
          | "WP_ERROR";
        message: string;
      };
    };

export async function testWpConnection(
  input: TestConnectionInput,
): Promise<TestConnectionResult> {
  const url = input.url.trim();
  if (!url) {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "WordPress URL is required.",
      },
    };
  }
  // Strip a single trailing slash so the wpFetch path concat doesn't
  // double up. The form normalises this client-side too; defence in
  // depth here.
  const baseUrl = url.replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "Could not parse the URL. Use the full https:// origin.",
      },
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "URL must use http:// or https://.",
      },
    };
  }

  // WP Application Passwords are 24 chars formatted as "abcd efgh ijkl
  // mnop qrst uvwx" (4-char groups separated by spaces). Operators
  // sometimes copy them with surrounding whitespace. Strip both.
  const appPassword = input.app_password.replace(/\s+/g, "");
  if (appPassword.length === 0) {
    return {
      ok: false,
      error: {
        code: "AUTH_FAILED",
        message: "Application Password is empty after stripping whitespace.",
      },
    };
  }

  const cfg: WpConfig = {
    baseUrl,
    user: input.username.trim(),
    appPassword,
  };

  const meRes = await wpGetMe(cfg);
  if (!meRes.ok) {
    return translateWpError(meRes);
  }

  const hasPublishRole = meRes.roles.some((r) =>
    PUBLISH_ROLES.has(r.toLowerCase()),
  );
  const hasPublishCap = meRes.capabilities.publish_posts === true;
  if (!hasPublishRole && !hasPublishCap) {
    return {
      ok: false,
      error: {
        code: "INSUFFICIENT_ROLE",
        message: `User authenticated but lacks publish capability. Roles: ${meRes.roles.join(", ") || "(none)"}. Use an administrator or editor account.`,
      },
    };
  }

  return {
    ok: true,
    user: {
      display_name: meRes.display_name || meRes.username,
      username: meRes.username,
      roles: meRes.roles,
    },
  };
}

function translateWpError(err: WpError): TestConnectionResult {
  switch (err.code) {
    case "AUTH_FAILED":
      return {
        ok: false,
        error: {
          code: "AUTH_FAILED",
          message:
            "Credentials rejected. Check the username and Application Password.",
        },
      };
    case "NOT_FOUND":
      return {
        ok: false,
        error: {
          code: "REST_UNREACHABLE",
          message:
            "WP REST API not reachable. Confirm the URL and that the REST API isn't disabled by a security plugin.",
        },
      };
    case "NETWORK_ERROR":
      return {
        ok: false,
        error: {
          code: "NETWORK",
          message: `Could not reach the site: ${err.message}`,
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "WP_ERROR",
          message: `${err.code}: ${err.message}`,
        },
      };
  }
}
