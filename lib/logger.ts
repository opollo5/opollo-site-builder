import { getRequestContext } from "@/lib/request-context";

// ---------------------------------------------------------------------------
// Minimal structured logger. Zero deps; JSON-per-line to stdout/stderr.
//
// Shape:
//   { timestamp, level, msg, ...context, ...fields }
//
// - context (request_id / job_id / slot_id / user_id) is pulled from
//   AsyncLocalStorage, so callers never have to thread it manually.
// - fields is the caller's own structured payload.
// - level is "debug" | "info" | "warn" | "error".
//
// Why not pino: we want zero new runtime deps until we have somewhere
// to ship logs to (Axiom — blocked on AXIOM_TOKEN provisioning). When
// that token arrives, swap `emit()` for an @axiomhq/js transport. The
// API stays identical.
//
// Level filtering honours LOG_LEVEL (defaults to "info" in prod, "debug"
// in non-prod). Below-threshold calls are O(1) — no string building, no
// JSON.stringify.
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
