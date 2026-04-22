import { Axiom } from "@axiomhq/js";

import { getRequestContext } from "@/lib/request-context";

// ---------------------------------------------------------------------------
// Structured logger. JSON-per-line to stdout/stderr always; Axiom
// ingest additionally when AXIOM_TOKEN + AXIOM_DATASET are set.
//
// Shape:
//   { timestamp, level, msg, ...context, ...fields }
//
// - context (request_id / job_id / slot_id / user_id) is pulled from
//   AsyncLocalStorage, so callers never have to thread it manually.
// - fields is the caller's own structured payload.
// - level is "debug" | "info" | "warn" | "error".
//
// Level filtering honours LOG_LEVEL (defaults to "info" in prod, "debug"
// in non-prod). Below-threshold calls are O(1) — no string building, no
// JSON.stringify.
//
// Axiom transport (M10):
//   - Additive to stdout, not a replacement. stdout lines are what
//     Vercel's log explorer already indexes; Axiom is the long-retention
//     queryable store.
//   - Fire-and-forget: `axiom.ingest()` returns a promise we don't
//     await. A slow or down Axiom must not block a request.
//   - When AXIOM_TOKEN or AXIOM_DATASET is missing, the transport is a
//     no-op and stdout is the only sink. Tests + local dev stay
//     identical to the pre-M10 behaviour.
// ---------------------------------------------------------------------------

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldEmit(level: Level): boolean {
  return LEVELS[level] >= LEVELS[configuredLevel()];
}

type Fields = Record<string, unknown>;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Lazy singleton so we don't instantiate the Axiom client until the
// first log call (and never in builds without a token).
let cachedAxiom: Axiom | null | undefined = undefined;
function axiomClient(): Axiom | null {
  if (cachedAxiom !== undefined) return cachedAxiom;
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;
  if (!token || !dataset) {
    cachedAxiom = null;
    return null;
  }
  cachedAxiom = new Axiom({ token });
  return cachedAxiom;
}

// Reset helper — exposed only for tests that need to re-evaluate the
// env vars after mutation.
export function __resetAxiomClientForTests(): void {
  cachedAxiom = undefined;
}

function emit(level: Level, msg: string, fields?: Fields): void {
  if (!shouldEmit(level)) return;
  const context = getRequestContext();
  const record = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...context,
    ...(fields ? (sanitize(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console -- structured logger sink
    console.error(line);
  } else {
    // eslint-disable-next-line no-console -- structured logger sink
    console.log(line);
  }

  // Axiom ingest, additive. Fire-and-forget — failures must not
  // block the request. A promise-rejection handler on the client
  // surfaces transport errors to stderr without throwing upward.
  const ax = axiomClient();
  if (ax) {
    const dataset = process.env.AXIOM_DATASET!;
    try {
      ax.ingest(dataset, [record]);
    } catch (err) {
      // Synchronous throw from the SDK (e.g. malformed payload). Log
      // the failure locally; don't recurse into the logger.
      // eslint-disable-next-line no-console -- transport diagnostics
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          msg: "axiom_ingest_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}

export const logger = {
  debug(msg: string, fields?: Fields): void {
    emit("debug", msg, fields);
  },
  info(msg: string, fields?: Fields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Fields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Fields): void {
    emit("error", msg, fields);
  },
};

// Exposed for tests only — lets us assert on the emitted JSON without
// monkey-patching global console.
export const __internal = { emit, sanitize, shouldEmit };
