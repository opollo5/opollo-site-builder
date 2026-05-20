import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { typography, buildCssVariableBlock } from "@/lib/design-system/tokens";

describe("typography.fontSize", () => {
  it("all sizes except eyebrow are >= 1rem (16px)", () => {
    for (const [key, value] of Object.entries(typography.fontSize)) {
      if (key === "eyebrow") continue;
      const rem = parseFloat(value);
      expect(rem, `fontSize.${key} must be >= 1rem`).toBeGreaterThanOrEqual(1);
    }
  });

  it("eyebrow is 0.75rem (12px — documented design exception)", () => {
    expect(typography.fontSize.eyebrow).toBe("0.75rem");
  });
});

describe("buildCssVariableBlock", () => {
  it("returns empty string for empty overrides", () => {
    expect(buildCssVariableBlock({})).toBe("");
  });

  it("emits a :root block with supplied values", () => {
    const result = buildCssVariableBlock({ colorPk: "#ff0000", radius: "8px" });
    expect(result).toContain("--pk: #ff0000");
    expect(result).toContain("--radius: 8px");
    expect(result).toMatch(/^:root \{/);
  });

  it("omits undefined keys", () => {
    expect(buildCssVariableBlock({ colorPk: "#ff0000" })).not.toContain("--gr");
  });
});

function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !["node_modules", ".next", "dist"].includes(entry.name)) {
        walk(full);
      } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

const ROOT = path.resolve(__dirname, "../..");
const SRC_FILES = [
  ...collectFiles(path.join(ROOT, "app"), [".tsx", ".ts"]),
  ...collectFiles(path.join(ROOT, "components"), [".tsx", ".ts"]),
].filter((f) => !f.includes("email") && !f.includes("seed") && !f.includes("__tests__") && !f.includes(".test.") && !f.includes("(dev)"));

const subMinFontRe = /\btext-\[([0-9]|1[0-5])px\]/;

describe("No sub-16px arbitrary font sizes in source", () => {
  for (const file of SRC_FILES) {
    it(`${path.relative(ROOT, file)} has no text-[<16px]`, () => {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(subMinFontRe);
      if (match) {
        throw new Error(
          `Found sub-16px arbitrary text size "${match[0]}" in ${path.relative(ROOT, file)}`,
        );
      }
    });
  }
});

const hexInClassRe = /(?:className|style)=[^>]*#[0-9a-fA-F]{3,8}(?!\s*;)/;

describe("No hardcoded hex colours in className/style", () => {
  for (const file of SRC_FILES) {
    it(`${path.relative(ROOT, file)} has no hex in className/style`, () => {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(hexInClassRe);
      if (match) {
        throw new Error(
          `Found hex colour in className/style in ${path.relative(ROOT, file)}: ${match[0].slice(0, 80)}`,
        );
      }
    });
  }
});
