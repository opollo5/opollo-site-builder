# Bundled Fonts

All fonts are in woff2 format (Latin subset), sourced from Google Fonts / canonical upstream
repos, and licensed under the SIL Open Font Licence 1.1 (OFL-1.1 — free for commercial use).

Used by `lib/image/compositing/sharp-renderer.ts` — embedded as base64 data URIs in SVG
rendered by librsvg (bundled inside sharp 0.34.5). The compositor falls back to system
`sans-serif` when the woff2 files are absent.

## Fonts

| File | Family | Weight | Source | Licence |
|---|---|---|---|---|
| `Inter-Regular.woff2` | Inter | 400 | https://github.com/rsms/inter | `OFL-Inter.txt` |
| `Inter-Bold.woff2` | Inter | 700 | https://github.com/rsms/inter | `OFL-Inter.txt` |
| `Roboto-Regular.woff2` | Roboto | 400 | https://github.com/googlefonts/roboto | `OFL-Roboto.txt` |
| `Roboto-Bold.woff2` | Roboto | 700 | https://github.com/googlefonts/roboto | `OFL-Roboto.txt` |
| `Montserrat-Regular.woff2` | Montserrat | 400 | https://github.com/JulietaUla/Montserrat | `OFL-Montserrat.txt` |
| `Montserrat-Bold.woff2` | Montserrat | 700 | https://github.com/JulietaUla/Montserrat | `OFL-Montserrat.txt` |
| `OpenSans-Regular.woff2` | Open Sans | 400 | https://github.com/googlefonts/opensans | `OFL-OpenSans.txt` |
| `OpenSans-Bold.woff2` | Open Sans | 700 | https://github.com/googlefonts/opensans | `OFL-OpenSans.txt` |
| `Poppins-Regular.woff2` | Poppins | 400 | https://github.com/itfoundry/poppins | `OFL-Poppins.txt` |
| `Poppins-Bold.woff2` | Poppins | 700 | https://github.com/itfoundry/poppins | `OFL-Poppins.txt` |

## Licence notices

Each `OFL-{Family}.txt` file is the per-font copy of the SIL Open Font Licence 1.1. See those
files for the complete copyright notices and reserved font names. All fonts are free for
commercial use; the OFL does not require attribution in deployed products, only in redistribution
of the font files themselves.

## Adding fonts for A-NEW-3 (template editor)

When A-NEW-3 (template editor) adds a font picker, add a corresponding row to the table above,
download the woff2 + OFL licence, add `.gitignore` exceptions, and update `sharp-renderer.ts`
to register the new family.
