// ---------------------------------------------------------------------------
// Reusable SQL-injection payload list. Use in route-layer tests where
// a string flows into PostgREST or a custom RPC call. Drive each
// payload through the real route and assert:
//
//   - The route returns a successful 200 / 4xx based on whether the
//     value is a valid input shape, NOT 500.
//   - The DB state after the call is unchanged (no DROP, no UPDATE).
//
// Supabase-js + PostgREST parameterise queries by default — these
// payloads should ALL fail safely. The point is to prove that, under
// every query path the route can take, no payload escapes the
// parameter binder.
// ---------------------------------------------------------------------------

export const SQL_INJECTION_PAYLOADS: Array<{
  payload: string;
  technique: string;
}> = [
  { payload: "' OR '1'='1", technique: "boolean tautology" },
  { payload: "' OR 1=1 --", technique: "comment-out tail" },
  {
    payload: "'; DROP TABLE users; --",
    technique: "stacked DROP statement",
  },
  { payload: "1; SELECT pg_sleep(5)", technique: "stacked SELECT" },
  {
    payload: "' UNION SELECT password FROM users --",
    technique: "UNION exfiltration",
  },
  { payload: "admin'--", technique: "username break + comment" },
  {
    payload: "'; SELECT * FROM information_schema.tables --",
    technique: "schema enumeration",
  },
  { payload: "1 OR 1=1", technique: "numeric injection" },
  {
    payload: "0x27 OR 0x31=0x31",
    technique: "hex-encoded boolean tautology",
  },
  {
    payload: "%27%20OR%201=1--",
    technique: "URL-encoded boolean tautology",
  },
];

export const SQL_INJECTION_PAYLOAD_STRINGS = SQL_INJECTION_PAYLOADS.map(
  (p) => p.payload,
);
