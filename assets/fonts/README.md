# Bundled Fonts

## Inter

Inter is used by the sharp-based image compositor (`lib/image/compositing/sharp-renderer.ts`).

**Source:** https://github.com/rsms/inter (OFL-1.1 licence — free for commercial use).

**Files required** (not committed to git due to binary size — download on first use):
- `Inter-Bold.ttf`
- `Inter-Regular.ttf`

To download:
```
npx fontsource-dl inter
# or manually from https://github.com/rsms/inter/releases
```

The compositor falls back to `sans-serif` (system font) when the TTF files are absent.
System sans-serif is acceptable for local dev and CI; production should have the files present.

**Licence notice:** Inter is © 2020 The Inter Project Authors, licensed under the SIL Open Font
Licence 1.1 (OFL-1.1). This notice must accompany any distribution that includes the font files.
