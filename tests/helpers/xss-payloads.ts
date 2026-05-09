// ---------------------------------------------------------------------------
// Reusable XSS payload list. Use in component-layer tests that drive
// user input through a render boundary, in route-layer tests that
// echo content back, and in any sanitiser unit test.
//
// Each payload has a comment naming the technique it tests so future
// edits don't accidentally reduce coverage.
//
// Per the security realism rule: a passing test with these payloads
// must demonstrate the exploit is BLOCKED by the running system —
// not just that the payload exists in a list. Tests that import this
// list and never assert outcome are not security tests.
// ---------------------------------------------------------------------------

export const XSS_PAYLOADS: Array<{ payload: string; technique: string }> = [
  {
    payload: '<script>alert("xss")</script>',
    technique: "inline script tag",
  },
  {
    payload: '<img src=x onerror="alert(1)" />',
    technique: "img onerror handler",
  },
  {
    payload: '<svg onload="alert(1)"></svg>',
    technique: "svg onload handler",
  },
  {
    payload: 'javascript:alert(1)',
    technique: "javascript: URL scheme (href / src injection)",
  },
  {
    payload: '" onmouseover="alert(1)',
    technique: "attribute breakout via unescaped quote",
  },
  {
    payload: '<a href="javascript:alert(1)">x</a>',
    technique: "javascript: in anchor href",
  },
  {
    payload: '<iframe src="javascript:alert(1)"></iframe>',
    technique: "javascript: in iframe src",
  },
  {
    payload: "<details open ontoggle=alert(1)>",
    technique: "details element ontoggle (no quotes needed)",
  },
  {
    payload: '<input autofocus onfocus="alert(1)" />',
    technique: "autofocus + onfocus chain",
  },
  {
    payload: "<style>@import 'javascript:alert(1)';</style>",
    technique: "CSS import injection",
  },
  {
    payload: "<<SCRIPT>alert('xss')//<</SCRIPT>",
    technique: "double-bracket script tag (defeats naive < strip)",
  },
  {
    payload: "<scr<script>ipt>alert(1)</scr</script>ipt>",
    technique: "nested script (defeats single-pass strip)",
  },
];

export const XSS_PAYLOAD_STRINGS = XSS_PAYLOADS.map((p) => p.payload);
