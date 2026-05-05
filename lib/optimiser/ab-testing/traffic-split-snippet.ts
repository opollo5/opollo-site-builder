// ---------------------------------------------------------------------------
// JS hash traffic split for static-hosted A/B tests (Phase 1.5 follow-up,
// slice C).
//
// Static-hosted full_page mode writes HTML to SiteGround SFTP — there's
// no edge middleware to do server-side variant routing. We split traffic
// in the browser instead:
//
//   1. Mint a sticky visitor id (UUID) in localStorage on first visit.
//   2. Hash (visitor_id + test_id) → uint mod 100 = bucket [0..99].
//   3. bucket < traffic_split_percent → variant B; else variant A.
//   4. Persist the assignment in localStorage keyed by test_id (so the
//      same visitor stays on the same variant for the lifetime of the
//      test).
//   5. If the current page's variant doesn't match the assignment,
//      navigate to the assigned variant's URL.
//   6. Append `?opt_v=A` or `?opt_v=B` so the GA4 sync's existing
//      dimension reader (slice 19) attributes sessions correctly.
//
// Why this design:
//   - Sticky per visitor: prevents bouncing between variants and
//     polluting the per-variant CR.
//   - Hash includes test_id: starting a new test on the same page
//     re-buckets the visitor. Avoids carry-over from a previous test.
//   - localStorage (not cookie): no GDPR consent surface change; the id
//     is opaque + per-domain.
//   - Replace not redirect: location.replace doesn't add a back-button
//     entry. The visitor lands on the assigned variant and "back" goes
//     where they came from.
//   - Pure logic, no external deps: snippet is ~700 bytes inlined.
//
// The snippet is emitted in <head> as the very first script so it runs
// before content render — a flash of the wrong variant would skew
// behaviour metrics.
// ---------------------------------------------------------------------------

export interface TrafficSplitConfig {
  /** opt_tests.id — used as localStorage key suffix and as a salt in
   *  the bucketing hash. Different test_id → different buckets. */
  test_id: string;
  /** 1..99. Percent of traffic routed to B. A receives the rest. */
  traffic_split_percent: number;
  /** Absolute or root-relative URL of variant A. Must match the URL
   *  the operator configured in opt_variants for the A variant. */
  variant_a_url: string;
  /** Absolute or root-relative URL of variant B. */
  variant_b_url: string;
  /** Which variant THIS page IS. The snippet uses this to decide
   *  whether to redirect. */
  this_variant: "A" | "B";
}

export function renderTrafficSplitSnippet(cfg: TrafficSplitConfig): string {
  // Validate at compose time so a malformed config never reaches the
  // browser. The static writer aborts before publishing if any of these
  // fail; far better than letting bad JSON through to the page.
  if (!/^[A-Z]$/.test(cfg.this_variant) || !["A", "B"].includes(cfg.this_variant)) {
    throw new Error(
      `traffic-split: this_variant must be "A" or "B", got ${cfg.this_variant}`,
    );
  }
  if (
    !Number.isInteger(cfg.traffic_split_percent) ||
    cfg.traffic_split_percent < 1 ||
    cfg.traffic_split_percent > 99
  ) {
    throw new Error(
      `traffic-split: traffic_split_percent must be integer 1..99, got ${cfg.traffic_split_percent}`,
    );
  }
  if (!cfg.test_id || !/^[A-Za-z0-9_-]+$/.test(cfg.test_id)) {
    throw new Error(
      `traffic-split: test_id must be safe id chars, got "${cfg.test_id}"`,
    );
  }
  if (!cfg.variant_a_url || !cfg.variant_b_url) {
    throw new Error("traffic-split: variant_a_url and variant_b_url required");
  }

  // JSON.stringify is the only way to get URL strings into the snippet
  // safely. This handles quotes, backslashes, and unicode without
  // hand-rolling escaping.
  const payload = JSON.stringify({
    t: cfg.test_id,
    s: cfg.traffic_split_percent,
    a: cfg.variant_a_url,
    b: cfg.variant_b_url,
    v: cfg.this_variant,
  });

  // The snippet is intentionally compact + readable. No minification
  // pass — the static writer doesn't bundle.
  return `<!-- Opollo A/B traffic split (test ${cfg.test_id}) -->
<script>(function(){try{
var c=${payload};
var s=window.localStorage;if(!s)return;
var vid=s.getItem('opollo_vid');
if(!vid){vid=(crypto&&crypto.randomUUID?crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));s.setItem('opollo_vid',vid);}
var key='opollo_v_'+c.t;
var assigned=s.getItem(key);
if(assigned!=='A'&&assigned!=='B'){
  var h=0;var src=vid+':'+c.t;
  for(var i=0;i<src.length;i++){h=((h<<5)-h+src.charCodeAt(i))|0;}
  var bucket=Math.abs(h)%100;
  assigned=bucket<c.s?'B':'A';
  s.setItem(key,assigned);
}
var target=assigned==='A'?c.a:c.b;
if(assigned!==c.v){
  var u=new URL(target,window.location.origin);
  u.searchParams.set('opt_v',assigned);
  window.location.replace(u.toString());
  return;
}
if(new URLSearchParams(window.location.search).get('opt_v')!==assigned){
  var u2=new URL(window.location.href);u2.searchParams.set('opt_v',assigned);
  window.history.replaceState(null,'',u2.toString());
}
}catch(e){}})();</script>`;
}
