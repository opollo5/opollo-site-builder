import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { runWithContext } from "@/lib/request-context";

// The logger writes JSON to stdout/stderr — capture via console spies.

let stdout: string[];
let stderr: string[];
let origLevel: string | undefined;

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  origLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "debug";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (origLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = origLevel;
});

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe("logger", () => {
  it("emits one JSON line per call with timestamp + level + msg", () => {
    logger.info("hello", { foo: "bar" });
    expect(stdout).toHaveLength(1);
    const record = parse(stdout[0]);
    expect(record.level).toBe("info");
    expect(record.msg).toBe("hello");
    expect(record.foo).toBe("bar");
    expect(typeof record.timestamp).toBe("string");
  });

  it("routes warn + error to stderr; info + debug to stdout", () => {
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(stdout.map((l) => parse(l).level)).toEqual(["debug", "info"]);
    expect(stderr.map((l) => parse(l).level)).toEqual(["warn", "error"]);
  });

  it("attaches request-context fields automatically", async () => {
    await runWithContext({ request_id: "rid-1", job_id: "job-9" }, () => {
      logger.info("scoped");
    });
    const record = parse(stdout[0]);
    expect(record.request_id).toBe("rid-1");
    expect(record.job_id).toBe("job-9");
  });

  it("respects LOG_LEVEL=info and drops debug", () => {
    process.env.LOG_LEVEL = "info";
    logger.debug("nope");
    logger.info("yes");
    expect(stdout).toHaveLength(1);
    expect(parse(stdout[0]).msg).toBe("yes");
  });

  it("serialises Error objects with name/message/stack", () => {
    logger.error("boom", { err: new Error("kaboom") });
    const record = parse(stderr[0]);
    const err = record.err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("kaboom");
    expect(typeof err.stack).toBe("string");
  });

  it("coerces bigint so JSON.stringify doesn't throw", () => {
    logger.info("big", { count: 9_999_999_999_999n });
    expect(stdout).toHaveLength(1);
    expect(parse(stdout[0]).count).toBe("9999999999999");
  });
});
