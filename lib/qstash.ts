import "server-only";

import { Client, Receiver } from "@upstash/qstash";

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// QStash client + receiver — Upstash's HTTP-native delayed-message queue.
//
// Lazy singletons. Returns null when env vars aren't set so tests + local
// dev stay no-op rather than hard-failing at module load. Same pattern as
// lib/redis.ts.
//
// Env contract:
//   QSTASH_TOKEN                — publish credential (server → Upstash)
//   QSTASH_CURRENT_SIGNING_KEY  — verifies inbound webhook signatures
//   QSTASH_NEXT_SIGNING_KEY     — verifies inbound webhook signatures
//                                 during a key rotation. Optional but
//                                 strongly recommended in prod.
//
// Callers (invitation enqueue + webhook handlers) check for null before
// using and degrade gracefully — the platform_invitations row exists with
// status='pending' regardless; missing callbacks just mean no day-3
// reminder and no auto-expiry mark. Acceptable for V1 — operators can
// revoke manually.
// ---------------------------------------------------------------------------

let cachedClient: Client | null | undefined = undefined;
let cachedReceiver: Receiver | null | undefined = undefined;

export function getQstashClient(): Client | null {
  if (cachedClient !== undefined) return cachedClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    cachedClient = null;
    return null;
  }
  cachedClient = new Client({ token });
  return cachedClient;
}

export function getQstashReceiver(): Receiver | null {
  if (cachedReceiver !== undefined) return cachedReceiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  if (!currentSigningKey) {
    cachedReceiver = null;
    return null;
  }
  cachedReceiver = new Receiver({
    currentSigningKey,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });
  return cachedReceiver;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_receiver" | "missing_signature" | "invalid" };

// Verifies the Upstash-Signature header against the raw body. Returns
// `no_receiver` when env is unset (tests + local dev). Webhook routes
// MUST treat `no_receiver` as a config error in production — they
// should refuse to run if the signing key is missing — but in test
// environments we mock this entire function.
export async function verifyQstashSignature(args: {
  signature: string | null;
  rawBody: string;
}): Promise<VerifyResult> {
  const receiver = getQstashReceiver();
  if (!receiver) return { ok: false, reason: "no_receiver" };
  if (!args.signature) return { ok: false, reason: "missing_signature" };
  try {
    await receiver.verify({
      signature: args.signature,
      body: args.rawBody,
    });
    return { ok: true };
  } catch (err) {
    logger.warn("qstash.verify_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "invalid" };
  }
}

export function __resetQstashForTests(): void {
  cachedClient = undefined;
  cachedReceiver = undefined;
}
