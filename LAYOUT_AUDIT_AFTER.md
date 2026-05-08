# Layout Audit

- Generated: 2026-05-08T14:33:23Z
- Repo SHA: 1019c1a3161ad64b17bfb13669f2588591f02f8b
- Output file: LAYOUT_AUDIT_AFTER.md

## Bug A: per-page max-w containers

- Pattern: `mx-auto.*max-w-(5xl|6xl|7xl)`
- Scope: `app/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
```

## Bug B: bare H1s (raw text-size, not PageHeader.Title)

- Pattern: `<h1[^>]*className="text-(2xl|xl|3xl|4xl|5xl)`
- Scope: `app/ components/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
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
- Scope: `app/ components/nav/ components/ui/ components/social/ components/optimiser/ components/admin/`
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
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
- Match count: 0
- Match hash: `e3b0c44298fc1c14`

```
(none)
```

## Summary

Re-run `bash scripts/layout-audit.sh <filename>` to regenerate.
Hashes are SHA-256 of full match output, first 16 chars.
Any reviewer can independently verify by re-running the script at the same commit.
