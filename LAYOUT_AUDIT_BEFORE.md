# Layout Audit

- Generated: 2026-05-08T13:53:44Z
- Repo SHA: 5f43b25bfe22d3797ca5c9ee2c15a703062f8c41
- Output file: LAYOUT_AUDIT_BEFORE.md

## Bug A: per-page max-w containers

- Pattern: `mx-auto.*max-w-(5xl|6xl|7xl)`
- Scope: `app/`
- Match count: 8
- Match hash: `d785d3271ed512d6`

```
app/admin/sites/[id]/posts/page.tsx:196:      <main className="mx-auto max-w-5xl">
app/company/image/generate/page.tsx:71:    <main className="mx-auto max-w-5xl p-6">
app/company/page.tsx:79:    <main className="mx-auto max-w-5xl p-6 space-y-6">
app/company/social/analytics/loading.tsx:4:    <main className="mx-auto max-w-6xl space-y-10 p-6 animate-pulse">
app/company/social/calendar/page.tsx:92:    <main className="mx-auto max-w-5xl p-6">
app/company/social/connections/page.tsx:125:    <main className="mx-auto max-w-5xl p-6">
app/company/social/media/page.tsx:45:    <main className="mx-auto max-w-6xl p-6">
app/company/social/timeline/page.tsx:75:    <main className="mx-auto max-w-5xl p-6">
```

## Bug B: bare H1s (raw text-size, not PageHeader.Title)

- Pattern: `<h1[^>]*className="text-(2xl|xl|3xl|4xl|5xl)`
- Scope: `app/ components/`
- Match count: 27
- Match hash: `c3a37f366edc9400`

```
app/approve/[token]/page.tsx:79:        <h1 className="text-2xl font-semibold">
app/approve/[token]/page.tsx:168:      <h1 className="text-xl font-semibold">Approval link not valid</h1>
app/approve/[token]/page.tsx:180:      <h1 className="text-xl font-semibold">Approval link revoked</h1>
app/approve/[token]/page.tsx:192:      <h1 className="text-xl font-semibold">Approval window closed</h1>
app/auth-error/page.tsx:22:      <h1 className="text-xl font-semibold">Authentication error</h1>
app/company/image/generate/page.tsx:81:        <h1 className="text-2xl font-semibold">Mood board generator</h1>
app/company/internal/autosave-lab/page.tsx:24:        <h1 className="text-xl font-semibold">Autosave Validation Lab</h1>
app/company/page.tsx:81:        <h1 className="text-2xl font-semibold">Welcome back</h1>
app/company/page.tsx:232:      <h1 className="text-2xl font-semibold">Welcome back</h1>
app/company/social/sharing/page.tsx:64:        <h1 className="text-2xl font-semibold">Calendar sharing</h1>
app/error.tsx:19:      <h1 className="text-xl font-semibold">Something went wrong</h1>
app/not-found.tsx:6:      <h1 className="text-xl font-semibold">Page not found</h1>
app/optimiser/change-log/page.tsx:26:          <h1 className="text-2xl font-semibold tracking-tight">Change log</h1>
app/optimiser/clients/[id]/settings/page.tsx:73:          <h1 className="text-2xl font-semibold tracking-tight">
app/optimiser/diagnostics/page.tsx:17:        <h1 className="text-2xl font-semibold tracking-tight">
app/optimiser/imports/[brief_id]/page.tsx:41:          <h1 className="text-2xl font-semibold tracking-tight">
app/optimiser/onboarding/page.tsx:19:          <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
app/optimiser/onboarding/[id]/page.tsx:31:          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
app/optimiser/page.tsx:71:          <h1 className="text-2xl font-semibold tracking-tight">Page browser</h1>
app/optimiser/page.tsx:103:        <h1 className="text-2xl font-semibold tracking-tight">Optimiser</h1>
app/optimiser/pages/[id]/page.tsx:138:          <h1 className="text-2xl font-semibold tracking-tight">
app/optimiser/proposals/page.tsx:33:          <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
app/viewer/[token]/page.tsx:133:        <h1 className="text-2xl font-semibold">
app/viewer/[token]/page.tsx:223:      <h1 className="text-xl font-semibold">Calendar link not valid</h1>
components/BriefRunClient.tsx:362:          <h1 className="text-2xl font-semibold">{brief.title}</h1>
... (+2 more)
```

## Bug C: breadcrumb in mt-5 wrapper (below H1)

- Pattern: `"mt-5"`
- Scope: `app/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
```

## Bug D: hex colours in JSX

- Pattern: `(bg|text|border|fill|stroke)-\[#[0-9a-fA-F]`
- Scope: `app/ components/`
- Match count: 18
- Match hash: `f9942f139a492936`

```
components/composer/live-preview-card.tsx:25:  linkedin_personal: "bg-[#0077B5]",
components/composer/live-preview-card.tsx:26:  linkedin_company: "bg-[#0077B5]",
components/composer/live-preview-card.tsx:27:  facebook_page: "bg-[#1877F2]",
components/composer/live-preview-card.tsx:29:  gbp: "bg-[#4285F4]",
components/SocialCalendarClient.tsx:418:                    !isLastRow && "border-b border-[#E5E7EB]",
components/SocialCalendarClient.tsx:419:                    !isLastCol && "border-r border-[#E5E7EB]",
components/SocialCalendarClient.tsx:438:                          ? "bg-[#00e5a0] text-white"
components/ui/button.tsx:20:          "bg-[#00e5a0] text-white font-semibold hover:brightness-110 hover:-translate-y-px hover:shadow-pk-glow active:translate-y-0 active:shadow-none",
components/ui/button.tsx:22:          "bg-[var(--btn-destructive-bg)] text-[var(--btn-destructive-text)] hover:bg-[#b91c1c] hover:-translate-y-px active:translate-y-0",
components/ui/button.tsx:26:          "bg-white border border-[#1F2937] text-[#1F2937] hover:bg-gray-50 hover:-translate-y-px active:translate-y-0",
components/ui/button.tsx:28:          "bg-transparent text-[#1F2937] hover:bg-[#F3F4F6] active:translate-y-px",
components/ui/icon-button.tsx:9:// bg-[#F3F4F6]. Must always carry an accessible label (aria-label or
components/ui/pill-select.tsx:36:  "inline-flex items-center justify-between gap-1.5 rounded-full border border-[#1F2937] bg-white font-medium text-[#1F2937] transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
components/ui/pill-tabs.tsx:12://   Active:   bg-[#00e5a0], white text, rounded-full
components/ui/pill-tabs.tsx:13://   Inactive: transparent bg, text-[#4B5563], rounded-full, hover bg-[#F3F4F6]
components/ui/pill-tabs.tsx:40:const TAB_ACTIVE = "bg-[#00e5a0] text-white";
components/ui/pill-tabs.tsx:43:  "bg-transparent text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827]";
components/ui/pill-tabs.tsx:45:const TAB_DISABLED = "bg-transparent text-[#9CA3AF] cursor-not-allowed";
```

## Bug E: rounded-full inline buttons (likely raw <button>)

- Pattern: `<button[^>]*className="[^"]*rounded-`
- Scope: `app/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
```

## Bug F: per-page header.mb-8 blocks

- Pattern: `<header className="mb-8"`
- Scope: `app/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
```

## Bug G: NavShellClient prop usage

- Pattern: `contentMaxWidth|contentPadding`
- Scope: `app/ components/`
- Match count: 16
- Match hash: `fe3319bdceb69e03`

```
app/account/layout.tsx:43:        contentMaxWidth="6xl"
app/admin/layout.tsx:39:        contentMaxWidth="7xl"
app/company/layout.tsx:48:        contentMaxWidth="5xl"
app/optimiser/layout.tsx:34:        contentMaxWidth="6xl"
components/nav/nav-shell-client.tsx:55:  contentMaxWidth: string;
components/nav/nav-shell-client.tsx:56:  contentPadding: string;
components/nav/nav-shell-client.tsx:65:  contentMaxWidth,
components/nav/nav-shell-client.tsx:66:  contentPadding,
components/nav/nav-shell-client.tsx:242:            contentPadding,
components/nav/nav-shell-client.tsx:245:          <div className={cn("mx-auto", `max-w-${contentMaxWidth}`)}>
components/nav/nav-shell.tsx:21:  contentMaxWidth?: string;
components/nav/nav-shell.tsx:22:  contentPadding?: string;
components/nav/nav-shell.tsx:29:  contentMaxWidth = "7xl",
components/nav/nav-shell.tsx:30:  contentPadding = "px-4 py-6 sm:px-8 sm:py-8",
components/nav/nav-shell.tsx:51:        contentMaxWidth={contentMaxWidth}
components/nav/nav-shell.tsx:52:        contentPadding={contentPadding}
```

## Summary

Re-run `bash scripts/layout-audit.sh <filename>` to regenerate.
Hashes are SHA-256 of full match output, first 16 chars.
Any reviewer can independently verify by re-running the script at the same commit.
