// Empty module. Vitest aliases `server-only` to this file in
// vitest.config.ts because the real `server-only` package's exports
// field only matches Next.js's `react-server` condition — vitest
// resolves to the default (throw-at-import) module otherwise. See
// vitest.config.ts for the alias rationale.
export {};
