/**
 * Opollo Wireframe Generator
 * --------------------------
 * Builds the remaining wireframe HTML files by composing shared partials.
 * Run: node build.js
 *
 * Each wireframe is a function of (page-config) and the shared shell partials.
 * This mirrors how Claude Code should implement these as React components:
 * one <AppShell> wrapper, one <Topbar>, one <Sidebar>, page-specific content inside.
 */

const fs = require('fs');
const path = require('path');

const OUT = '/home/claude/wireframes';

// ─── Shared SVG snippets ───────────────────────────────────
const ICONS = {
  search:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  chevDown:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  chevRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  chevLeft:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  x:         `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  plus:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  edit:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  copy:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  clock:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  calendar:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  trash:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  lightbulb: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z"/></svg>`,
  image:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  smile:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
  link:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  tag:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  sparkles:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>`,
  external:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  globe:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  more:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  thumbsUp:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/></svg>`,
  message:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  share:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  send:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  info:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  eye:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  cursor:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>`,
  download:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
};

// Platform brand SVGs (compact)
const BRAND = {
  linkedin: `<svg viewBox="0 0 22 22"><rect width="22" height="22" rx="3" fill="#0A66C2"/><path fill="white" d="M5.5 8.5h2.6v8h-2.6zm1.3-3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm3.7 3.5h2.5v1.1c.4-.7 1.4-1.4 2.8-1.4 3 0 3.6 2 3.6 4.6v4.7h-2.6v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.3h-2.5z"/></svg>`,
  facebook: `<svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="11" fill="#1877F2"/><path fill="white" d="M14.9 14l.4-2.9h-2.8V9.1c0-.8.4-1.5 1.6-1.5h1.3V5.1S14.3 4.9 13.2 4.9c-2.3 0-3.8 1.4-3.8 3.9V11H6.9v2.9h2.5V21h3.1v-7h2.4z"/></svg>`,
  x: `<svg viewBox="0 0 22 22"><rect width="22" height="22" rx="3" fill="#000"/><path fill="white" d="M14.7 5h2.4l-5.2 5.9 6.1 8.1h-4.7L9.5 14l-4.2 5H3l5.5-6.3L2.7 5H7.5l3.3 4.4L14.7 5z"/></svg>`,
  instagram: `<svg viewBox="0 0 22 22"><defs><linearGradient id="ig-g-${Math.random().toString(36).slice(2,7)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F58529"/><stop offset=".3" stop-color="#DD2A7B"/><stop offset=".6" stop-color="#8134AF"/><stop offset="1" stop-color="#515BD4"/></linearGradient></defs><rect width="22" height="22" rx="6" fill="url(#ig-g-fixed)"/><rect x="5" y="5" width="12" height="12" rx="4" fill="none" stroke="white" stroke-width="1.6"/><circle cx="11" cy="11" r="3" fill="none" stroke="white" stroke-width="1.6"/><circle cx="15.2" cy="6.8" r=".9" fill="white"/></svg>`,
  gbp: `<svg viewBox="0 0 22 22"><rect width="22" height="22" rx="3" fill="#4584ED"/><path fill="white" d="M18.9 10.3h-3.8v1.5h2.2c-.3 1.3-1.4 2.2-2.8 2.2-1.7 0-3-1.4-3-3s1.3-3 3-3c.8 0 1.5.3 2 .8l1.2-1.1c-.9-.9-2-1.4-3.2-1.4-2.5 0-4.6 2-4.6 4.6S11 15.6 13.5 15.6c2.7 0 4.5-1.9 4.5-4.6 0-.2 0-.5-.1-.7z"/></svg>`,
  tiktok: `<svg viewBox="0 0 22 22"><rect width="22" height="22" rx="3" fill="#000"/><path fill="white" d="M14.5 7.5c-.6-.7-1-1.7-1-2.7H11l-.1 8.4c0 1-1 1.7-1.9 1.7-.8 0-1.4-.5-1.7-1.2-.7-.4-1.2-1.1-1.2-2 0-1.2.9-2.1 2.1-2.1.2 0 .4 0 .6.1V8c-2.1.1-3.7 1.8-3.7 3.9 0 1 .4 1.9 1 2.5.7.7 1.5 1.1 2.5 1.1 2.1 0 3.8-1.7 3.8-3.8V8.5c1 .7 2.2 1.1 3.5 1.1V7.4c-.4 0-.4 0-.4 0z"/></svg>`,
  pinterest: `<svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="11" fill="#E60023"/><path fill="white" d="M11 3a8 8 0 0 0-3 15.4c-.1-.7-.1-1.7 0-2.5l1-4.4s-.3-.5-.3-1.3c0-1.2.7-2.2 1.6-2.2.7 0 1.1.6 1.1 1.2 0 .7-.5 1.8-.7 2.8-.2.9.4 1.6 1.3 1.6 1.5 0 2.7-1.6 2.7-4 0-2-1.5-3.5-3.6-3.5-2.5 0-4 1.9-4 3.8 0 .8.3 1.6.7 2.1 0 0 0 .1 0 .2l-.3 1.2c0 .2-.2.2-.3.1-1.2-.5-1.9-2.2-1.9-3.6 0-2.9 2.1-5.6 6.1-5.6 3.2 0 5.7 2.3 5.7 5.3 0 3.2-2 5.8-4.8 5.8-.9 0-1.8-.5-2.1-1.1l-.6 2.2c-.2.8-.8 1.9-1.2 2.5A8 8 0 1 0 11 3z"/></svg>`,
};

// ─── Shared shell partials ─────────────────────────────────

function sidebar(activeKey = 'poster') {
  const item = (key, label, iconSvg, badge) => `
    <a href="#" class="sidebar__item${key === activeKey ? ' sidebar__item--active' : ''}">
      <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>
      ${label}
      ${badge ? `<span class="sidebar__badge">${badge}</span>` : ''}
    </a>`;
  return `
  <aside class="app-shell__sidebar">
    <div class="sidebar__brand">
      <div class="sidebar__logo">O</div>
      <div class="sidebar__brand-name">Opollo</div>
    </div>
    <div class="sidebar__group">
      <div class="sidebar__group-label">Workspace</div>
      ${item('home',  'Home',  `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`)}
      ${item('sites', 'Sites', `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>`)}
    </div>
    <div class="sidebar__group">
      <div class="sidebar__group-label">Social</div>
      ${item('poster',      'Social Poster', `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`)}
      ${item('analytics',   'Analytics',     `<path d="M3 3v18h18"/><path d="m7 15 4-4 4 4 5-5"/>`)}
      ${item('connections', 'Connections',   `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`)}
      ${item('cap',         'CAP',           `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>`, 'new')}
    </div>
    <div class="sidebar__group">
      <div class="sidebar__group-label">Account</div>
      ${item('team',    'Team',    `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`)}
      ${item('billing', 'Billing', `<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>`)}
    </div>
  </aside>`;
}

function topbar(companyName = 'Stellar Systems') {
  return `
  <header class="app-shell__topbar">
    <button class="topbar__company-switcher" aria-label="Switch company">
      <div class="topbar__company-icon"></div>
      <span>${companyName}</span>
      ${ICONS.chevDown.replace('width="16" height="16"', 'width="14" height="14"').replace('currentColor', 'currentColor" style="opacity:0.5')}
    </button>
    <div class="topbar__search">
      <span class="topbar__search-icon">${ICONS.search}</span>
      <input class="topbar__search-input" type="search" placeholder="Search">
    </div>
    <div class="topbar__actions">
      <a href="#" class="topbar__nav-link">Invite users</a>
      <a href="#" class="topbar__nav-link">Pricing</a>
      <button class="topbar__avatar">S</button>
    </div>
  </header>`;
}

function pageHeader(title, activeTab = 'Calendar') {
  const tabs = ['Calendar', 'Posts', 'Content ideas'];
  return `
  <div class="page-header">
    <nav class="breadcrumb">
      <a href="#">Home</a><span class="breadcrumb__sep">›</span>
      <a href="#">Social</a><span class="breadcrumb__sep">›</span>
      <span class="breadcrumb__current">${title}</span>
    </nav>
    <div class="page-title-row">
      <h1 class="page-title">${title}</h1>
      <div class="page-actions">
        <button class="btn btn--secondary">${ICONS.globe} Chrome extension</button>
        <button class="btn btn--secondary">Share</button>
        <button class="btn btn--secondary btn--icon" aria-label="Settings">${ICONS.info}</button>
      </div>
    </div>
    <nav class="tab-line">
      ${tabs.map(t => `<a href="#" class="tab-line__item${t === activeTab ? ' tab-line__item--active' : ''}">${t}</a>`).join('')}
      <div class="tab-line__meta">${ICONS.clock} Australia/Sydney</div>
    </nav>
  </div>`;
}

// ─── Document wrapper ─────────────────────────────────────
function htmlDoc(title, bodyContent, includeSpriteData = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Opollo Wireframe</title>
  <link rel="stylesheet" href="tokens.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body data-opollo-sprite>
${bodyContent}
<script src="interactions.js"></script>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────
// COMPOSER PARTIALS
// ──────────────────────────────────────────────────────────

function profileChip(brand, state = 'selected') {
  const cls = state === 'selected' ? 'profile-chip profile-chip--selected'
            : state === 'disconnected' ? 'profile-chip profile-chip--disconnected'
            : 'profile-chip';
  return `<button class="${cls}" aria-label="${brand}">${BRAND[brand]}</button>`;
}

function profileSelector(selected = []) {
  // selected: array of brand names. Empty = idle state.
  const brands = ['linkedin', 'gbp', 'facebook', 'x', 'instagram'];
  const chips = brands.map(b => profileChip(b, selected.includes(b) ? 'selected' : '')).join('');
  return `
  <div class="profile-selector">
    ${chips}
    <button class="profile-chip profile-chip__add" aria-label="Add profile">${ICONS.plus}</button>
    ${selected.length > 0 ? `<button class="profile-selector__deselect">Deselect all</button>` : ''}
  </div>`;
}

function contentCard(text = '', hasMedia = false, charCount = 0, limit = 3000) {
  const overLimit = charCount > limit;
  return `
  <div class="content-card">
    <textarea class="content-card__textarea" placeholder="Write your post or generate one with AI">${text}</textarea>
    ${hasMedia ? `
      <div class="content-card__media">
        <div class="media-thumb" style="background: linear-gradient(135deg, #FF03A5, #FFB574);"></div>
        <button class="media-thumb-add" aria-label="Add media">${ICONS.plus}</button>
      </div>` : ''}
    <div class="content-card__counter${overLimit ? ' content-card__counter--over' : ''}">${charCount} / ${limit}</div>
    <div class="tools-row">
      <button class="tool-btn">${ICONS.sparkles} AI assistant</button>
      <button class="tool-btn">${ICONS.image} Media</button>
      <button class="tool-btn">${ICONS.smile} Emoji</button>
      <button class="tool-btn">${ICONS.image} GIF</button>
      <button class="tool-btn">${ICONS.link} Shorten URL</button>
      <button class="tool-btn">${ICONS.tag} UTM tags</button>
    </div>
  </div>`;
}

function customizeRow(activePlatform = null) {
  const brands = ['linkedin', 'gbp', 'facebook', 'x'];
  return `
  <div class="customize-row">
    <span class="customize-row__label">Customize for</span>
    <div class="customize-row__chips">
      ${brands.map(b => `<button class="customize-row__chip${b === activePlatform ? ' customize-row__chip--active' : ''}" aria-label="${b}">${BRAND[b]}</button>`).join('')}
    </div>
  </div>`;
}

function platformActions(platforms = []) {
  // platforms: list like ['linkedin', 'gbp']
  if (!platforms.length) return '';
  const rows = platforms.map(p => {
    const label = p === 'linkedin' ? 'LinkedIn'
                : p === 'gbp' ? 'Google Business Profile'
                : p === 'facebook' ? 'Facebook'
                : p === 'x' ? 'X' : p;
    const affordance = p === 'linkedin' ? '+ Add link'
                     : p === 'gbp' ? '+ Add button'
                     : p === 'facebook' ? '+ Add link'
                     : p === 'x' ? '+ Add poll' : '+ Add link';
    return `
      <div class="platform-action">
        <span class="platform-action__icon">${BRAND[p]}</span>
        <span>${label}</span>
        <a href="#" class="platform-action__link">${affordance}</a>
      </div>`;
  }).join('');
  return `<div class="platform-actions">${rows}</div>`;
}

function schedulingCard(activeTab = 'schedule', extra = '') {
  const tabs = [
    { key: 'now',     label: 'Post now' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'regular', label: 'Publish regularly' },
    { key: 'draft',   label: 'Save as draft' }
  ];

  let content = '';
  if (activeTab === 'now') {
    content = `
      <p class="scheduling-content__hint">Publish immediately to the selected profiles. You can still review the preview on the right before submitting.</p>
      <div class="approval-row">
        <div class="toggle" role="switch" aria-checked="false"></div>
        <span class="approval-row__label">Send for client approval before publishing</span>
        <a href="#" class="approval-row__link">Learn more</a>
      </div>`;
  } else if (activeTab === 'schedule') {
    content = `
      <p class="scheduling-content__hint">Pick a date and time. Times are in Australia/Sydney; the recipient platform's timezone applies on publish.</p>
      <div class="schedule-row">
        <input type="date" class="schedule-input" value="2026-05-21">
        <input type="time" class="schedule-input" value="09:00">
        <button class="schedule-row__delete" aria-label="Remove time">${ICONS.trash}</button>
      </div>
      <div class="schedule-row">
        <input type="date" class="schedule-input" value="2026-05-21">
        <input type="time" class="schedule-input" value="14:30">
        <button class="schedule-row__delete" aria-label="Remove time">${ICONS.trash}</button>
      </div>
      <button class="schedule-add">${ICONS.plus} Add time</button>
      <div class="approval-row" style="margin-top: var(--space-4);">
        <div class="toggle toggle--on" role="switch" aria-checked="true"></div>
        <span class="approval-row__label">Send for client approval before publishing</span>
        <a href="#" class="approval-row__link">Learn more</a>
      </div>`;
  } else if (activeTab === 'regular') {
    content = `
      <p class="scheduling-content__hint">Repeat this post on a fixed cadence. Useful for recurring tips, opening-hours reminders, or evergreen content.</p>
      <div class="recurrence-grid">
        <span class="recurrence-label">Repeat every</span>
        <div class="recurrence-control">
          <input type="number" class="schedule-input" value="2" min="1" max="365">
          <select class="schedule-input">
            <option>weeks</option>
            <option>hours</option>
            <option>days</option>
            <option>months</option>
          </select>
        </div>
        <span class="recurrence-label">Starting on</span>
        <div class="recurrence-control">
          <input type="date" class="schedule-input" value="2026-05-21" style="flex:1;">
          <input type="time" class="schedule-input" value="09:00" style="flex:1;">
        </div>
        <span class="recurrence-label">Until</span>
        <div class="recurrence-control">
          <input type="date" class="schedule-input" value="2026-08-21" style="flex:1;">
          <label class="u-flex u-items-center u-gap-2 u-text-xs u-text-muted"><input type="checkbox"> No end date</label>
        </div>
      </div>
      <div class="approval-row">
        <div class="toggle toggle--on" role="switch" aria-checked="true"></div>
        <span class="approval-row__label">Send each occurrence for approval</span>
        <a href="#" class="approval-row__link">Why this matters</a>
      </div>
      <div style="padding: var(--space-3) var(--space-4); background: var(--color-info-soft); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--color-info); margin-top: var(--space-3);">
        ${ICONS.info} The first 6 occurrences will be auto-generated on save. Approve each before its scheduled time.
      </div>`;
  } else if (activeTab === 'draft') {
    content = `
      <p class="scheduling-content__hint">Save without scheduling. Drafts appear in the Posts list with a "Draft" badge.</p>
      <div class="schedule-row">
        <input type="date" class="schedule-input" value="2026-05-21" placeholder="Plan for">
        <input type="time" class="schedule-input" value="09:00">
        <button class="schedule-row__delete" aria-label="Remove planned time">${ICONS.trash}</button>
      </div>
      <p class="u-text-xs u-text-muted">Planned time is a hint to your team — the post will not auto-publish.</p>`;
  }

  return `
  <div class="scheduling-card">
    <div class="scheduling-tabs">
      ${tabs.map(t => `<button class="scheduling-tabs__item${t.key === activeTab ? ' scheduling-tabs__item--active' : ''}">${t.label}</button>`).join('')}
    </div>
    <div class="scheduling-content">
      ${content}
    </div>
  </div>
  ${extra}`;
}

function submitRow(scheduleMode = 'schedule') {
  const labels = { now: 'Post now', schedule: 'Schedule post', regular: 'Save schedule', draft: 'Save draft' };
  return `
  <div class="submit-row">
    <button class="btn btn--secondary">Discard</button>
    <button class="btn btn--primary btn--lg submit-row__primary">${labels[scheduleMode] || 'Submit'}</button>
  </div>`;
}

function previewEmpty() {
  return `
  <div class="preview-empty">
    <svg class="preview-empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
    </svg>
    <h3 class="preview-empty__title">Select a profile to preview</h3>
    <p class="preview-empty__body">Pick at least one social profile above. Your post will render here exactly as it will appear when published.</p>
  </div>`;
}

function previewCard(brand, body, hasImage = true) {
  const meta = brand === 'linkedin' ? '1,247 followers · 2h · 🌐'
             : brand === 'facebook' ? 'Stellar Systems · 2h · 🌐'
             : brand === 'x' ? '@stellarsys · 2h'
             : brand === 'gbp' ? 'Stellar Systems · 1 Walters Dr, Osborne Park'
             : 'Stellar Systems · 2h';
  const name = brand === 'gbp' ? 'Stellar Systems' : 'Stellar Systems';
  const label = brand === 'linkedin' ? 'LINKEDIN' : brand === 'gbp' ? 'GOOGLE BUSINESS PROFILE' : brand === 'facebook' ? 'FACEBOOK' : brand === 'x' ? 'X' : 'INSTAGRAM';
  const cardClass = brand === 'gbp' ? 'preview-card preview-card--gbp' : 'preview-card';
  return `
  <div class="preview-platform-badge">${BRAND[brand].replace('<svg', '<svg width="14" height="14"')} ${label}</div>
  <div class="${cardClass}">
    <div class="preview-card__head">
      <div class="preview-card__avatar">S</div>
      <div class="preview-card__id-stack">
        <div class="preview-card__name">${name}</div>
        <div class="preview-card__meta">${meta}</div>
      </div>
      <button class="preview-card__more" aria-label="More">${ICONS.more}</button>
    </div>
    <p class="preview-card__body">${body}</p>
    ${hasImage ? `<div class="preview-card__image" style="background: linear-gradient(135deg, #FF03A5 0%, #00E5A0 100%); aspect-ratio: ${brand === 'gbp' ? '4/3' : '1.91/1'};"></div>` : ''}
    ${brand !== 'gbp' ? `
    <div class="preview-card__footer">
      <button class="preview-card__action">${ICONS.thumbsUp} Like</button>
      <button class="preview-card__action">${ICONS.message} Comment</button>
      <button class="preview-card__action">${ICONS.share} Share</button>
      <button class="preview-card__action">${ICONS.send} Send</button>
    </div>` : ''}
  </div>`;
}

function miniCalendar() {
  const rows = [
    [27, 28, 29, 30, 1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15, 16, 17],
    [18, 19, 20, 21, 22, 23, 24],
    [25, 26, 27, 28, 29, 30, 31]
  ];
  const today = 18;
  const hasPosts = [1, 7, 9, 15, 18, 23];
  return `
  <div class="mini-cal">
    <div class="mini-cal__head">
      <h3 class="mini-cal__title">May 2026</h3>
      <button class="btn btn--ghost btn--icon btn--sm" aria-label="Previous">${ICONS.chevLeft}</button>
      <button class="btn btn--ghost btn--icon btn--sm" aria-label="Next">${ICONS.chevRight}</button>
    </div>
    <div class="mini-cal__grid">
      ${['M','T','W','T','F','S','S'].map(d => `<div class="mini-cal__weekday">${d}</div>`).join('')}
      ${rows.flat().map((d, i) => {
        const otherMonth = (i < 4) || (i > 30 && d <= 7);
        const isToday = d === today && !otherMonth;
        const hasPost = hasPosts.includes(d) && !otherMonth;
        let cls = 'mini-cal__day';
        if (otherMonth) cls += ' mini-cal__day--other-month';
        if (isToday) cls += ' mini-cal__day--today';
        if (hasPost && !isToday) cls += ' mini-cal__day--has-post';
        return `<button class="${cls}">${d}</button>`;
      }).join('')}
    </div>
  </div>`;
}

// ──────────────────────────────────────────────────────────
// COMPOSER PAGES
// ──────────────────────────────────────────────────────────

function composerPage({ profiles = [], content = '', scheduleTab = 'schedule', activePreviewTab = 'preview', showCustomize = false, modal = null }) {
  const isMulti = profiles.length > 1;
  const showPreview = profiles.length > 0;

  const leftPane = `
    <div class="composer__pane composer__pane--left">
      <button class="composer__close" aria-label="Close composer">${ICONS.x}</button>
      <h2 class="composer__title">${profiles.length ? 'Edit post' : 'New post'}</h2>
      ${profileSelector(profiles)}
      ${contentCard(content, content.length > 0, content.length)}
      ${showCustomize ? customizeRow(profiles[0]) : ''}
      ${platformActions(profiles)}
      ${schedulingCard(scheduleTab)}
      ${submitRow(scheduleTab)}
    </div>`;

  let rightPaneContent = '';
  if (activePreviewTab === 'calendar') {
    rightPaneContent = miniCalendar();
  } else if (showPreview) {
    rightPaneContent = profiles.map(p => previewCard(p, content || 'Your post content will appear here as you type. This is a live preview of how it will look once published.')).join('');
  } else {
    rightPaneContent = previewEmpty();
  }

  const rightPane = `
    <div class="composer__pane composer__pane--right">
      <div class="preview-tabs">
        <button class="preview-tabs__item${activePreviewTab === 'preview' ? ' preview-tabs__item--active' : ''}">Post preview</button>
        <button class="preview-tabs__item${activePreviewTab === 'calendar' ? ' preview-tabs__item--active' : ''}">Calendar</button>
      </div>
      ${rightPaneContent}
    </div>`;

  return `
${modal || ''}
<div class="composer-overlay">
  ${leftPane}
  ${rightPane}
</div>`;
}

// ──────────────────────────────────────────────────────────
// MODAL PAGES
// ──────────────────────────────────────────────────────────

function unsavedChangesModal() {
  return `
<div class="modal-backdrop">
  <div class="modal modal--sm">
    <div class="modal__head" style="border-bottom: none; padding-bottom: 0;">
      <h2 class="modal__title">Do you want to save your changes?</h2>
      <button class="modal__close" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="modal__body">
      <p class="u-text-sm u-text-muted" style="margin: 0;">If you close the composer now, your edits will be lost.</p>
    </div>
    <div class="modal__foot">
      <button class="btn btn--ghost">Don't save</button>
      <button class="btn btn--secondary">Continue editing</button>
      <button class="btn btn--primary">Save</button>
    </div>
  </div>
</div>`;
}

function bulkUploadModal(state = 'empty') {
  const body = state === 'empty' ? `
    <div class="bulk-upload">
      <div class="bulk-upload__illo">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
          <line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
      </div>
      <h3 class="bulk-upload__title">Import from a CSV file</h3>
      <p class="bulk-upload__subtitle">Up to 100 posts from one table.</p>
      <a href="#" class="bulk-upload__info">More information</a>
      <div class="bulk-upload__actions">
        <button class="btn btn--primary btn--lg">${ICONS.download} Upload CSV</button>
        <a href="#" class="bulk-upload__download">${ICONS.download} Download example</a>
      </div>
      <p class="bulk-upload__hint">You can drag &amp; drop your file here</p>
    </div>` : `
    <div style="padding: var(--space-4); ">
      <div class="u-flex u-items-center u-gap-3" style="padding: var(--space-3); background: var(--color-bg-muted); border-radius: var(--radius-sm); margin-bottom: var(--space-4);">
        ${ICONS.download}
        <div style="flex:1;">
          <div class="u-text-sm" style="font-weight: var(--weight-medium);">opollo-may-content.csv</div>
          <div class="u-text-xs u-text-muted">24 KB · 87 rows · 3 errors</div>
        </div>
        <button class="btn btn--ghost btn--sm">Replace</button>
      </div>
      <div style="border: 1px solid var(--color-border-soft); border-radius: var(--radius-md); overflow: hidden; margin-bottom: var(--space-4);">
        <table style="width: 100%; border-collapse: collapse; font-size: var(--text-xs);">
          <thead style="background: var(--color-bg-muted);">
            <tr><th style="text-align:left; padding: var(--space-2) var(--space-3); color: var(--color-text-muted); font-weight: var(--weight-semibold);">#</th><th style="text-align:left; padding: var(--space-2) var(--space-3); color: var(--color-text-muted); font-weight: var(--weight-semibold);">Content</th><th style="text-align:left; padding: var(--space-2) var(--space-3); color: var(--color-text-muted); font-weight: var(--weight-semibold);">Date</th><th style="text-align:left; padding: var(--space-2) var(--space-3); color: var(--color-text-muted); font-weight: var(--weight-semibold);">Time</th><th style="text-align:left; padding: var(--space-2) var(--space-3); color: var(--color-text-muted); font-weight: var(--weight-semibold);">Channel</th></tr>
          </thead>
          <tbody>
            <tr style="border-top: 1px solid var(--color-border-soft);"><td style="padding: var(--space-2) var(--space-3); color: var(--color-text-muted);">1</td><td style="padding: var(--space-2) var(--space-3); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Tips for running a secure MSP in 2026.</td><td style="padding: var(--space-2) var(--space-3);">05/21/2026</td><td style="padding: var(--space-2) var(--space-3);">09:00</td><td style="padding: var(--space-2) var(--space-3);">LinkedIn</td></tr>
            <tr style="border-top: 1px solid var(--color-border-soft); background: var(--color-danger-soft);"><td style="padding: var(--space-2) var(--space-3); color: var(--color-danger);">2</td><td style="padding: var(--space-2) var(--space-3); color: var(--color-danger); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Welcome our new — date in past</td><td style="padding: var(--space-2) var(--space-3); color: var(--color-danger);">04/15/2025</td><td style="padding: var(--space-2) var(--space-3);">10:00</td><td style="padding: var(--space-2) var(--space-3);">LinkedIn</td></tr>
            <tr style="border-top: 1px solid var(--color-border-soft);"><td style="padding: var(--space-2) var(--space-3); color: var(--color-text-muted);">3</td><td style="padding: var(--space-2) var(--space-3); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Visit us this Saturday — autumn hours start now.</td><td style="padding: var(--space-2) var(--space-3);">05/21/2026</td><td style="padding: var(--space-2) var(--space-3);">14:00</td><td style="padding: var(--space-2) var(--space-3);">(all)</td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding: var(--space-3) var(--space-4); background: var(--color-danger-soft); border-radius: var(--radius-sm); color: var(--color-danger); font-size: var(--text-xs);">
        3 errors found. Fix them in your CSV and re-upload — partial imports are not supported.
      </div>
    </div>`;

  return `
<div class="modal-backdrop">
  <div class="modal">
    <div class="modal__head">
      <h2 class="modal__title">Bulk scheduling</h2>
      <button class="modal__close" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="modal__body" style="padding: 0;">
      ${body}
    </div>
    ${state === 'uploaded' ? `
    <div class="modal__foot">
      <button class="btn btn--secondary">Cancel</button>
      <button class="btn btn--primary" disabled style="opacity: 0.5;">Schedule all (fix errors first)</button>
    </div>` : ''}
  </div>
</div>`;
}

function analyticsModal() {
  return `
<div class="modal-backdrop">
  <div class="modal modal--lg">
    <div class="modal__head" style="border-bottom: none;">
      <h2 class="modal__title" style="font-size: var(--text-md);">Post performance</h2>
      <button class="modal__close" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="modal__body" style="padding-top: 0;">
      <div class="analytics-grid">
        <!-- Left: post render -->
        <div>
          ${previewCard('linkedin', 'Building marketing automation for MSPs is hard. Three lessons we learned shipping CAP this quarter.')}
        </div>
        <!-- Right: stats + sections -->
        <div>
          <div class="analytics-stats">
            <div class="analytics-card">
              <div class="analytics-card__label">${ICONS.eye} Impressions</div>
              <div class="analytics-card__value">12,847</div>
            </div>
            <div class="analytics-card">
              <div class="analytics-card__label">${ICONS.sparkles} Eng. rate</div>
              <div class="analytics-card__value">4.2%</div>
            </div>
          </div>
          <div class="analytics-section">
            <div class="analytics-section__head">Engagement details</div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.thumbsUp}</span>
              <span class="analytics-section__row-label">Reactions</span>
              <span class="analytics-section__row-value">342</span>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.share}</span>
              <span class="analytics-section__row-label">Shares</span>
              <span class="analytics-section__row-value">58</span>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.message}</span>
              <span class="analytics-section__row-label">Comments</span>
              <span class="analytics-section__row-value">47</span>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.cursor}</span>
              <span class="analytics-section__row-label">Clicks</span>
              <span class="analytics-section__row-value">893</span>
            </div>
          </div>
          <div class="analytics-section">
            <div class="analytics-section__head">Post info</div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.calendar}</span>
              <span class="analytics-section__row-label">Published</span>
              <span class="analytics-section__row-value">May 18, 2026 · 16:37 AEST</span>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.link}</span>
              <span class="analytics-section__row-label">Post link</span>
              <a href="#" class="analytics-section__row-link u-truncate" style="max-width: 180px;">linkedin.com/posts/stellar-systems-act…</a>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.cursor}</span>
              <span class="analytics-section__row-label">Author</span>
              <span class="analytics-section__row-value">Steven Morey</span>
            </div>
            <div class="analytics-section__row">
              <span class="analytics-section__row-icon">${ICONS.tag}</span>
              <span class="analytics-section__row-label">Tags</span>
              <span class="analytics-section__row-value">CAP launch · Q2</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal__foot">
      <button class="btn btn--secondary">${ICONS.external} Open post</button>
      <button class="btn btn--secondary">${ICONS.more} More</button>
      <button class="btn btn--primary">${ICONS.edit} Schedule again</button>
    </div>
  </div>
</div>`;
}

function addProfileDropdown() {
  const items = [
    { brand: 'facebook',  label: 'Connect Facebook' },
    { brand: 'instagram', label: 'Connect Instagram' },
    { brand: 'tiktok',    label: 'Connect TikTok', isNew: true },
    { brand: 'linkedin',  label: 'Connect LinkedIn' },
    { brand: 'gbp',       label: 'Connect Google Business Profile' },
    { brand: 'pinterest', label: 'Connect Pinterest' },
  ];

  return `
<div class="filter-bar" style="padding: var(--space-6); position: relative; background: var(--color-bg-canvas);">
  <button class="filter-bar__profile-select" id="dropdown-trigger" aria-expanded="true">
    All profiles
    ${ICONS.chevDown}
  </button>
  
  <!-- Stage 1: All profiles dropdown -->
  <div class="dropdown" style="top: 56px; left: 152px;">
    <button class="dropdown__item" style="justify-content: space-between;">
      <span>Add profile</span>
      ${ICONS.chevRight}
    </button>
  </div>

  <!-- Stage 2: Sub-menu opens to the right -->
  <div class="dropdown" style="top: 56px; left: 392px;">
    ${items.map(it => `
      <button class="dropdown__item">
        <span class="dropdown__item-icon">${BRAND[it.brand]}</span>
        <span>${it.label}</span>
        ${it.isNew ? `<span class="badge-new">new</span>` : ''}
      </button>`).join('')}
  </div>
</div>

<div style="padding: var(--space-6); max-width: 720px; margin: 0 auto;">
  <h2 style="font-family: var(--font-display); font-size: var(--text-xl); margin: 0 0 var(--space-3);">Add-profile dropdown</h2>
  <p class="u-text-sm u-text-muted">
    Triggered by the "All profiles" button in the filter bar. Two-stage dropdown: first level shows "Add profile" (which expands the right-side sub-menu), second level lists all available connections with their brand icons. TikTok carries the "new" badge using <code>--color-brand-green</code>. Each item routes to <code>/company/social/connections/connect/:platform</code>.
  </p>
</div>`;
}

// ──────────────────────────────────────────────────────────
// PAGE BUILD ORDER
// ──────────────────────────────────────────────────────────

const pages = [
  // composer wireframes
  {
    file: '02-composer-idle.html',
    title: '02 — Composer (idle, no profile selected)',
    content: composerPage({ profiles: [], content: '', scheduleTab: 'schedule', activePreviewTab: 'preview' })
  },
  {
    file: '03-composer-with-content.html',
    title: '03 — Composer (LinkedIn selected, with content)',
    content: composerPage({
      profiles: ['linkedin'],
      content: 'Building marketing automation for MSPs is hard. Here\'s what we\'ve learned shipping CAP this quarter — three lessons from getting clients across the line on automated content.',
      scheduleTab: 'schedule',
      activePreviewTab: 'preview'
    })
  },
  {
    file: '04-composer-multi-platform.html',
    title: '04 — Composer (multi-platform with Customize-for)',
    content: composerPage({
      profiles: ['linkedin', 'gbp'],
      content: 'Visit us at 1 Walters Dr — now open Saturdays 9–2 for the autumn season. New stock arriving weekly.',
      scheduleTab: 'schedule',
      activePreviewTab: 'preview',
      showCustomize: true
    })
  },
  {
    file: '05-composer-schedule.html',
    title: '05 — Composer (Schedule tab detail)',
    content: composerPage({
      profiles: ['linkedin'],
      content: 'A behind-the-scenes look at how we\'re thinking about content automation for cybersecurity firms.',
      scheduleTab: 'schedule',
      activePreviewTab: 'calendar'
    })
  },
  {
    file: '06-composer-publish-regularly.html',
    title: '06 — Composer (Publish-regularly tab)',
    content: composerPage({
      profiles: ['linkedin', 'facebook'],
      content: 'Cyber-tip Tuesday: rotate your team\'s passwords on a fixed cadence. Set it once, repeat fortnightly.',
      scheduleTab: 'regular',
      activePreviewTab: 'calendar'
    })
  },
  {
    file: '07-composer-save-as-draft.html',
    title: '07 — Composer (Save-as-draft tab)',
    content: composerPage({
      profiles: ['linkedin'],
      content: 'Draft idea — circle back next week. Need to add the case-study quote from Wednesday\'s call.',
      scheduleTab: 'draft',
      activePreviewTab: 'preview'
    })
  },
  {
    file: '08-composer-unsaved-modal.html',
    title: '08 — Composer (Unsaved-changes modal)',
    content: composerPage({
      profiles: ['linkedin'],
      content: 'Building marketing automation for MSPs is hard.',
      scheduleTab: 'schedule',
      activePreviewTab: 'preview',
      modal: unsavedChangesModal()
    })
  },
  // modals (standalone wireframes)
  {
    file: '09-bulk-csv-modal.html',
    title: '09 — Bulk CSV upload modal (empty)',
    content: `<div class="app-shell"><aside class="app-shell__sidebar"></aside><header class="app-shell__topbar"></header><main class="app-shell__content"></main></div>${bulkUploadModal('empty')}`
  },
  {
    file: '09a-bulk-csv-uploaded.html',
    title: '09a — Bulk CSV upload modal (file uploaded, with errors)',
    content: `<div class="app-shell"><aside class="app-shell__sidebar"></aside><header class="app-shell__topbar"></header><main class="app-shell__content"></main></div>${bulkUploadModal('uploaded')}`
  },
  {
    file: '10-post-analytics-modal.html',
    title: '10 — Post analytics modal',
    content: `<div class="app-shell"><aside class="app-shell__sidebar"></aside><header class="app-shell__topbar"></header><main class="app-shell__content"></main></div>${analyticsModal()}`
  },
  {
    file: '11-add-profile-dropdown.html',
    title: '11 — Add-profile dropdown (cascade)',
    content: `<div class="app-shell">${sidebar()}${topbar()}<main class="app-shell__content">${pageHeader('Social Poster')}${addProfileDropdown()}</main></div>`
  },
];

// Build all pages
pages.forEach(p => {
  const full = htmlDoc(p.title, p.content);
  fs.writeFileSync(path.join(OUT, p.file), full);
  console.log(`Built: ${p.file}`);
});

console.log('\nDone — all wireframes generated.');
