/**
 * scripts/smoke/assertions.ts
 *
 * Assertion helpers for smoke tests.
 */

export function assertStatus(
  res: Response,
  expected: number,
  context = "",
): void {
  if (res.status !== expected) {
    throw new Error(
      `${context ? `[${context}] ` : ""}Expected HTTP ${expected}, got ${res.status} ${res.url}`,
    );
  }
}

export function assertShape(
  obj: Record<string, unknown>,
  keys: string[],
  context = "",
): void {
  const missing = keys.filter((k) => !(k in obj));
  if (missing.length > 0) {
    throw new Error(
      `${context ? `[${context}] ` : ""}Response missing keys: ${missing.join(", ")}. Got: ${JSON.stringify(obj).slice(0, 200)}`,
    );
  }
}

export function assertTruthy(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}
