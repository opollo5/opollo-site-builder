import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  passwordStrengthHint,
  validatePassword,
} from "@/lib/password-policy";

describe("validatePassword", () => {
  it("accepts a 12-character password", () => {
    const result = validatePassword("dodecakepass");
    expect(result.ok).toBe(true);
  });

  it("accepts a longer password", () => {
    const result = validatePassword("correct horse battery staple");
    expect(result.ok).toBe(true);
  });

  it("rejects an 11-character password with TOO_SHORT", () => {
    const result = validatePassword("elevenchars");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContain("TOO_SHORT");
    expect(result.message).toMatch(/at least 12/);
  });

  it("rejects an empty password with EMPTY + TOO_SHORT", () => {
    const result = validatePassword("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContain("EMPTY");
    expect(result.message).toBe("Password is required.");
  });

  it("rejects whitespace-only passwords", () => {
    const result = validatePassword("            ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContain("WHITESPACE_ONLY");
  });

  it("rejects passwords longer than 256 chars", () => {
    const result = validatePassword("a".repeat(257));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContain("TOO_LONG");
  });

  it("uses the exported PASSWORD_MIN_LENGTH", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });
});

describe("passwordStrengthHint", () => {
  it("returns null when the password meets the policy", () => {
    expect(passwordStrengthHint("dodecakepass")).toBeNull();
  });

  it("prompts for initial input when empty", () => {
    expect(passwordStrengthHint("")).toBe("Enter a password.");
  });

  it("reports characters remaining when short", () => {
    expect(passwordStrengthHint("short")).toBe("7 more characters needed.");
  });

  it("uses singular when 1 character remains", () => {
    expect(passwordStrengthHint("elevenchars")).toBe("1 more character needed.");
  });
});
