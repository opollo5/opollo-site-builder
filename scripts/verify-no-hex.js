#!/usr/bin/env node
// AST-based check: no hex colour literals in JSX className strings or style props.
// Allowed: brand-colour maps in components/composer/live-preview-card.tsx
//          (platform brand colours cannot be expressed as CSS vars).
// Exit 0 = clean; exit 1 = violations found.

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const HEX_RE = /(?:bg|text|border|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/;

const ALLOWLIST = new Set([
  path.resolve("components/composer/live-preview-card.tsx"),
]);

const SCAN_DIRS = ["app", "components"];
const EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function checkFile(filePath) {
  if (ALLOWLIST.has(path.resolve(filePath))) return [];

  const src = fs.readFileSync(filePath, "utf8");
  // Quick pre-check to skip files without any hex patterns
  if (!HEX_RE.test(src)) return [];

  const violations = [];

  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    // If parsing fails, fall back to line-level grep
    src.split("\n").forEach((line, i) => {
      if (HEX_RE.test(line) && !line.trimStart().startsWith("//")) {
        violations.push({ file: filePath, line: i + 1, text: line.trim() });
      }
    });
    return violations;
  }

  traverse(ast, {
    StringLiteral(nodePath) {
      if (HEX_RE.test(nodePath.node.value)) {
        violations.push({
          file: filePath,
          line: nodePath.node.loc?.start.line ?? "?",
          text: nodePath.node.value.slice(0, 120),
        });
      }
    },
    TemplateLiteral(nodePath) {
      for (const quasi of nodePath.node.quasis) {
        if (HEX_RE.test(quasi.value.raw)) {
          violations.push({
            file: filePath,
            line: quasi.loc?.start.line ?? "?",
            text: quasi.value.raw.slice(0, 120),
          });
        }
      }
    },
  });

  return violations;
}

const allViolations = [];
for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of collectFiles(dir)) {
    allViolations.push(...checkFile(file));
  }
}

if (allViolations.length === 0) {
  console.log("verify-no-hex: clean ✓");
  process.exit(0);
} else {
  console.error(`verify-no-hex: ${allViolations.length} violation(s) found\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}
