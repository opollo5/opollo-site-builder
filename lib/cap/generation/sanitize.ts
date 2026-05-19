import { logger } from "@/lib/logger";

// Prompt injection patterns — case-insensitive, strip and replace with [FILTERED].
// Applied to all user-supplied strings before they are concatenated into Anthropic prompts.
const DANGEROUS_PATTERNS: RegExp[] = [
  /ignore\s+(previous|above|prior|all\s+previous)/gi,
  /disregard\s+(previous|above|prior|instructions)/gi,
  /^(system|assistant|user)\s*:/gim,
  /you('?re|\s+are)\s+now/gi,
  /new\s+instructions?\s*:/gi,
  /updated\s+instructions?\s*:/gi,
  /<\/?\w[\w\s/='".-]*>/g, // XML/HTML-shaped tags (open + close)
];

/**
 * Sanitizes a user-supplied string before injecting it into an Anthropic prompt.
 * Strips dangerous prompt-injection patterns and logs a warning if any were found.
 */
export function sanitizePromptInput(text: string): string {
  let result = text;
  let matched = false;

  for (const pattern of DANGEROUS_PATTERNS) {
    const before = result;
    result = result.replace(pattern, "[FILTERED]");
    if (result !== before) matched = true;
  }

  if (matched) {
    logger.warn("cap.sanitize.injection_detected", { original: text.slice(0, 200) });
  }

  return result;
}

/**
 * Sanitizes every item in a string array. Returns a new array.
 */
export function sanitizePromptArray(items: string[]): string[] {
  return items.map((item) => sanitizePromptInput(item));
}
