import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { constantTimeEqual } from "@/lib/crypto-compare";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  flushLangfuse,
  getLangfuseClient,
} from "@/lib/langfuse";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

// ---------------------------------------------------------------------------
// POST /api/ops/self-probe — M10.
//
// Verification endpoint for the four observability vendors. Fires one
// event at each + returns a per-vendor status envelope so the runbook
// step (curl against deployed URL) can confirm receipt without a
// dashboard pass.
//
// Auth: admin session (Supabase Auth) OR a valid OPOLLO_EMERGENCY_KEY
// header. The emergency-key path exists so the runbook works even if
// Supabase Auth is down at verification time — verification shouldn't
// itself depend on the observability we're verifying.
//
// Shape of the response (ok=true at top level iff every vendor ok):
//   {
//     ok: boolean,
//     timestamp: string,
//     probe_id: string,
//     vendors: {
//       sentry:   { ok, eventId?, error? },
//       axiom:    { ok, dataset?, error? },
//       langfuse: { ok, traceId?, error? },
//       upstash:  { ok, roundTripMs?, error? },
//     }
//   }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MIN_KEY_LENGTH = 32;

function hasEmergencyKey(req: NextRequest): boolean {
  const expected = process.env.OPOLLO_EMERGENCY_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) return false;
  const provided =
    req.headers.get("x-opollo-emergency-key") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  return constantTimeEqual(provided, expected);
}

type VendorStatus =
  | { ok: true; details?: Record<string, unknown> }
  | { ok: false; error: string };

async function probeSentry(probeId: string): Promise<VendorStatus> {
  if (!process.env.SENTRY_DSN) {
    return { ok: false, error: "SENTRY_DSN not set" };
  }
  try {
    // captureException returns the event id synchronously; flush
    // ensures the transport has actually shipped it before we reply.
    const eventId = Sentry.captureException(
      new Error(`m10_self_probe: ${probeId}`),
      {
        tags: { source: "self_probe", probe_id: probeId },
      },
    );
    await Sentry.flush(5000);
    return { ok: true, details: { eventId } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeAxiom(probeId: string): Promise<VendorStatus> {
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  if (!token || !dataset) {
    return {
      ok: false,
      error: `AXIOM_TOKEN or AXIOM_DATASET not set (token=${Boolean(token)}, dataset=${Boolean(dataset)})`,
    };
  }
  try {
    // The logger emits to Axiom additively; a single info call is
    // enough to prove ingest. No API to confirm receipt synchronously
    // (Axiom's query API returns indexed rows, typically 5-30s after
    // ingest). For the self-probe, SDK success is the signal — a
    // query-side verification belongs in the runbook's "if the probe
    // says ok but data isn't visible" troubleshooting entry.
    logger.info("m10_self_probe_axiom", {
      probe_id: probeId,
      source: "self_probe",
    });
    return { ok: true, details: { dataset } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeLangfuse(probeId: string): Promise<VendorStatus> {
  const client = getLangfuseClient();
  if (!client) {
    return {
      ok: false,
      error:
        "LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set (or client init failed)",
    };
  }
  try {
    const trace = client.trace({
      name: "m10_self_probe",
      metadata: { probe_id: probeId, source: "self_probe" },
    });
    trace.event({
      name: "probe_event",
      input: { probe_id: probeId },
    });
    await flushLangfuse();
    return { ok: true, details: { traceId: trace.id ?? null } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeUpstash(probeId: string): Promise<VendorStatus> {
  const redis = getRedisClient();
  if (!redis) {
    return {
      ok: false,
      error: "UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set",
    };
  }
  const key = `m10:self-probe:${probeId}`;
  const start = Date.now();
  try {
    // Write with a short TTL so probe keys don't accumulate.
    await redis.set(key, probeId, { ex: 60 });
    const echoed = await redis.get<string>(key);
    const roundTripMs = Date.now() - start;
    if (echoed !== probeId) {
      return {
        ok: false,
        error: `round-trip read returned ${JSON.stringify(echoed)}, expected ${probeId}`,
      };
    }
    return { ok: true, details: { roundTripMs } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function generateProbeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Two auth paths: Supabase admin session OR pre-shared emergency
  // key. Either is sufficient.
  const gate = await requireAdminForApi();
  const emergencyOk = hasEmergencyKey(req);
  if (gate.kind === "deny" && !emergencyOk) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Admin session or OPOLLO_EMERGENCY_KEY required.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 401 },
    );
  }

  const probeId = generateProbeId();
  const startedAt = Date.now();

  // Run probes in parallel — each vendor is independent.
  const [sentry, axiom, langfuse, upstash] = await Promise.all([
    probeSentry(probeId),
    probeAxiom(probeId),
    probeLangfuse(probeId),
    probeUpstash(probeId),
  ]);

  const vendors = {
    sentry,
    axiom,
    langfuse,
    upstash,
  };
  const ok = Object.values(vendors).every((v) => v.ok);
  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json(
    {
      ok,
      probe_id: probeId,
      elapsed_ms: elapsedMs,
      vendors,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 502 },
  );
}
