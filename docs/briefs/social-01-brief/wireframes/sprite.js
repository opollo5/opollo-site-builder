/* ============================================================
   Opollo wireframes — Shared SVG icon definitions
   ============================================================
   Inline this at the top of each HTML file inside an
   <svg style="display:none"> block, then reference via
   <use href="#icon-name" />.
   
   Platform brand icons are simple, public-brand representations
   (LinkedIn, Facebook, etc. logos — they are the platforms'
   own marks, used in every social tool as preview labels).
   ============================================================ */

(function() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
    <defs>
      <!-- UI icons (24x24 stroke icons) -->
      <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
      </symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6"/>
      </symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m9 18 6-6-6-6"/>
      </symbol>
      <symbol id="i-chevron-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14"/><path d="M5 12h14"/>
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </symbol>
      <symbol id="i-reload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
      </symbol>
      <symbol id="i-lightbulb" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z"/>
      </symbol>
      <symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
      </symbol>
      <symbol id="i-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
      </symbol>
      <symbol id="i-smile" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
      </symbol>
      <symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </symbol>
      <symbol id="i-tag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
      </symbol>
      <symbol id="i-sparkles" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
      </symbol>
      <symbol id="i-external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
      </symbol>
      <symbol id="i-more" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></symbol>
      <symbol id="i-thumbs-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/>
      </symbol>
      <symbol id="i-message" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </symbol>
      <symbol id="i-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
      </symbol>
      <symbol id="i-mouse-pointer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>
      </symbol>

      <!-- Platform brand icons (22x22, used as preview labels) -->
      <symbol id="brand-linkedin" viewBox="0 0 22 22">
        <rect width="22" height="22" rx="3" fill="#0A66C2"/>
        <path fill="white" d="M5.5 8.5h2.6v8h-2.6v-8zm1.3-3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm3.7 3.5h2.5v1.1c.4-.7 1.4-1.4 2.8-1.4 3 0 3.6 2 3.6 4.6v4.7h-2.6v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.3h-2.5v-8z"/>
      </symbol>
      <symbol id="brand-facebook" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="11" fill="#1877F2"/>
        <path fill="white" d="M14.9 14l.4-2.9h-2.8V9.1c0-.8.4-1.5 1.6-1.5h1.3V5.1S14.3 4.9 13.2 4.9c-2.3 0-3.8 1.4-3.8 3.9V11H6.9v2.9h2.5V21h3.1v-7h2.4z"/>
      </symbol>
      <symbol id="brand-x" viewBox="0 0 22 22">
        <rect width="22" height="22" rx="3" fill="#000"/>
        <path fill="white" d="M14.7 5h2.4l-5.2 5.9 6.1 8.1h-4.7L9.5 14l-4.2 5H3l5.5-6.3L2.7 5H7.5l3.3 4.4L14.7 5zM13.8 17.7h1.3L7.3 6.2H5.9l7.9 11.5z"/>
      </symbol>
      <symbol id="brand-instagram" viewBox="0 0 22 22">
        <defs>
          <linearGradient id="ig-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#F58529"/>
            <stop offset=".3" stop-color="#DD2A7B"/>
            <stop offset=".6" stop-color="#8134AF"/>
            <stop offset="1" stop-color="#515BD4"/>
          </linearGradient>
        </defs>
        <rect width="22" height="22" rx="6" fill="url(#ig-grad)"/>
        <rect x="5" y="5" width="12" height="12" rx="4" fill="none" stroke="white" stroke-width="1.6"/>
        <circle cx="11" cy="11" r="3" fill="none" stroke="white" stroke-width="1.6"/>
        <circle cx="15.2" cy="6.8" r=".9" fill="white"/>
      </symbol>
      <symbol id="brand-gbp" viewBox="0 0 22 22">
        <rect width="22" height="22" rx="3" fill="#4584ED"/>
        <path fill="white" d="M18.9 10.3h-3.8v1.5h2.2c-.3 1.3-1.4 2.2-2.8 2.2-1.7 0-3-1.4-3-3s1.3-3 3-3c.8 0 1.5.3 2 .8l1.2-1.1c-.9-.9-2-1.4-3.2-1.4-2.5 0-4.6 2-4.6 4.6S11 15.6 13.5 15.6c2.7 0 4.5-1.9 4.5-4.6 0-.2 0-.5-.1-.7z"/>
        <path fill="white" opacity=".75" d="M3 8h4v6H3z"/>
      </symbol>
      <symbol id="brand-tiktok" viewBox="0 0 22 22">
        <rect width="22" height="22" rx="3" fill="#000"/>
        <path fill="#25F4EE" d="M14.5 7.5v-2h-1.8c.4 1.6 1.5 2 1.8 2z"/>
        <path fill="#FE2C55" d="M9.8 11c-1.2 0-2.1.9-2.1 2.1 0 .9.5 1.6 1.3 1.9-.4-.4-.6-.8-.6-1.5 0-1.2.9-2.1 2.1-2.1.2 0 .4 0 .6.1V9.4l-.6-.1c-.2 0-.4 0-.7 0v1.7z"/>
        <path fill="white" d="M14.5 7.5c-.6-.7-1-1.7-1-2.7H11l-.1 8.4c0 1-1 1.7-1.9 1.7-.8 0-1.4-.5-1.7-1.2-.7-.4-1.2-1.1-1.2-2 0-1.2.9-2.1 2.1-2.1.2 0 .4 0 .6.1V8c-2.1.1-3.7 1.8-3.7 3.9 0 1 .4 1.9 1 2.5.7.7 1.5 1.1 2.5 1.1 2.1 0 3.8-1.7 3.8-3.8V8.5c1 .7 2.2 1.1 3.5 1.1V7.4c-.4 0-.4 0-.4 0z"/>
      </symbol>
    </defs>
  </svg>`;
  
  // Inject on load if requested
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('[data-opollo-sprite]')) {
        document.body.insertAdjacentHTML('afterbegin', svg);
      }
    });
  }
  
  // Export for direct inline use
  if (typeof window !== 'undefined') window.OPOLLO_SPRITE = svg;
})();
