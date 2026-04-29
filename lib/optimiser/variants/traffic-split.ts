// Traffic-split snippet for A/B tests (Phase 2 Slice 18).
//
// Decision: JS-side deterministic hash split. Picked over the Ads API
// final-URL-swap approach because rapid URL flips on a campaign can
// trip Google Ads policy review and add friction the experiment doesn't
// need. The JS path puts the assignment under our control and works
// the same on every traffic source.
//
// How it works on the page:
//   1. Read or generate a stable visitor session id (cookie
//      `opt_session`).
//   2. Hash the session id via FNV-1a (small, deterministic, stable
//      across browsers — sufficient for binary bucketing).
//   3. Reduce mod 100. Compare to traffic_split_percent. If less than
//      the percent, this visitor is in bucket B; otherwise bucket A.
//   4. If the page being served doesn't match the assigned bucket,
//      do a soft client-side redirect (location.replace) to the
//      sibling URL.
//   5. Set a `opt_test_<test_id>` cookie pinning the assignment so a
//      visitor stays in the same bucket on return visits.
//   6. Append ?opt_v=A or ?opt_v=B to the URL on assignment so GA4
//      can dimension the traffic without us having to reverse-engineer
//      the assignment server-side.
//
// The script is small enough to inline in <head>; no external file
// fetch on first paint.

export interface TrafficSplitConfig {
  /** opt_tests.id — keys the cookie. */
  test_id: string;
  /** opt_variants.id for variant A (control / approved-proposal). */
  variant_a_id: string;
  /** opt_variants.id for variant B (alternative). */
  variant_b_id: string;
  /** Percent of traffic going to B; remainder goes to A. 1..99. */
  traffic_split_percent: number;
  /** Public URL of the A page. */
  variant_a_url: string;
  /** Public URL of the B page. */
  variant_b_url: string;
  /** This page's variant label — passed to the snippet so it knows
   * whether to redirect. */
  current_variant: "A" | "B";
}

export function buildTrafficSplitScript(cfg: TrafficSplitConfig): string {
  if (cfg.traffic_split_percent < 1 || cfg.traffic_split_percent > 99) {
    throw new Error(
      `buildTrafficSplitScript: traffic_split_percent must be 1..99, got ${cfg.traffic_split_percent}`,
    );
  }
  const payload = JSON.stringify({
    t: cfg.test_id,
    a: cfg.variant_a_id,
    b: cfg.variant_b_id,
    s: cfg.traffic_split_percent,
    au: cfg.variant_a_url,
    bu: cfg.variant_b_url,
    c: cfg.current_variant,
  });
  // Snippet is hand-written for size + reliability rather than imported
  // from a bundle. Comments stripped at injection time.
  return `<script>(function(){
var cfg=${payload};
function readCookie(n){var m=document.cookie.match(new RegExp('(^| )'+n+'=([^;]+)'));return m?decodeURIComponent(m[2]):null;}
function writeCookie(n,v){document.cookie=n+'='+encodeURIComponent(v)+'; path=/; max-age=2592000; SameSite=Lax';}
function fnv1a(s){var h=2166136261>>>0;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h;}
var sid=readCookie('opt_session');
if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);writeCookie('opt_session',sid);}
var pinned=readCookie('opt_test_'+cfg.t);
var bucket;
if(pinned==='A'||pinned==='B'){bucket=pinned;}
else{var bk=fnv1a(sid+':'+cfg.t)%100;bucket=bk<cfg.s?'B':'A';writeCookie('opt_test_'+cfg.t,bucket);}
try{
var url=new URL(window.location.href);
if(!url.searchParams.has('opt_v'))url.searchParams.set('opt_v',bucket);
if(bucket!==cfg.c){var dest=bucket==='A'?cfg.au:cfg.bu;var d=new URL(dest);d.searchParams.set('opt_v',bucket);location.replace(d.toString());return;}
if(url.toString()!==window.location.href)history.replaceState(null,'',url.toString());
}catch(e){}
})();</script>`;
}

/** Inject the traffic-split script into a composed full-page HTML
 * document just before the closing </head>. Idempotent — no-op if a
 * data-opt-split marker is already present. Returns the modified HTML. */
export function injectTrafficSplitScript(
  html: string,
  cfg: TrafficSplitConfig,
): string {
  if (html.includes("data-opt-split")) {
    return html;
  }
  const tag = buildTrafficSplitScript(cfg).replace(
    "<script>",
    `<script data-opt-split="${cfg.test_id}">`,
  );
  const closing = "</head>";
  const idx = html.indexOf(closing);
  if (idx === -1) {
    // No </head> — this shouldn't happen for full_page output, but
    // gracefully prepend the snippet to the body so the visit still
    // gets bucketed.
    return tag + html;
  }
  return html.slice(0, idx) + tag + html.slice(idx);
}
