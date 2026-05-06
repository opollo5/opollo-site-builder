import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// lib/prompts unit tests — CHAT_PROMPT_VERSION + resolvePrompt().
//
// Contract:
//  1. CHAT_PROMPT_VERSION is "v1".
//  2. resolvePrompt() with no args returns the v1 system.md path.
//  3. resolvePrompt("v1") returns the same path.
//  4. OPOLLO_PROMPT_VERSION env overrides the default version.
//  5. An explicit version argument takes precedence over the env var.
//  6. Generation prompt exports are non-empty strings.
// ---------------------------------------------------------------------------

import {
  CHAT_PROMPT_VERSION,
  resolvePrompt,
  SITE_PLANNER_SYSTEM_PROMPT,
  PAGE_GENERATOR_SYSTEM_PROMPT,
  PAGE_CRITIQUE_PROMPT,
  PAGE_REVISE_PROMPT,
  SECTION_REGEN_SYSTEM_PROMPT,
} from "@/lib/prompts";

const ORIGINAL_PROMPT_VERSION = process.env.OPOLLO_PROMPT_VERSION;

beforeEach(() => {
  delete process.env.OPOLLO_PROMPT_VERSION;
});

afterEach(() => {
  if (ORIGINAL_PROMPT_VERSION === undefined) {
    delete process.env.OPOLLO_PROMPT_VERSION;
  } else {
    process.env.OPOLLO_PROMPT_VERSION = ORIGINAL_PROMPT_VERSION;
  }
});

describe("CHAT_PROMPT_VERSION", () => {
  it("is v1", () => {
    expect(CHAT_PROMPT_VERSION).toBe("v1");
  });
});

describe("resolvePrompt", () => {
  it("defaults to the v1 system.md path when no args and env is unset", () => {
    const expected = join(process.cwd(), "lib", "prompts", "v1", "system.md");
    expect(resolvePrompt()).toBe(expected);
  });

  it("returns the v1 path when called with 'v1'", () => {
    const expected = join(process.cwd(), "lib", "prompts", "v1", "system.md");
    expect(resolvePrompt("v1")).toBe(expected);
  });

  it("reads OPOLLO_PROMPT_VERSION when set and no explicit version given", () => {
    process.env.OPOLLO_PROMPT_VERSION = "v2";
    const expected = join(process.cwd(), "lib", "prompts", "v2", "system.md");
    expect(resolvePrompt()).toBe(expected);
  });

  it("explicit version argument wins over OPOLLO_PROMPT_VERSION env", () => {
    process.env.OPOLLO_PROMPT_VERSION = "v2";
    const expected = join(process.cwd(), "lib", "prompts", "v1", "system.md");
    expect(resolvePrompt("v1")).toBe(expected);
  });
});

describe("generation prompt exports", () => {
  it.each([
    ["SITE_PLANNER_SYSTEM_PROMPT", SITE_PLANNER_SYSTEM_PROMPT],
    ["PAGE_GENERATOR_SYSTEM_PROMPT", PAGE_GENERATOR_SYSTEM_PROMPT],
    ["PAGE_CRITIQUE_PROMPT", PAGE_CRITIQUE_PROMPT],
    ["PAGE_REVISE_PROMPT", PAGE_REVISE_PROMPT],
    ["SECTION_REGEN_SYSTEM_PROMPT", SECTION_REGEN_SYSTEM_PROMPT],
  ])("%s is a non-empty string", (_name, value) => {
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });
});
