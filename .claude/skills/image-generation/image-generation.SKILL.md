---
name: image-generation
description: Use this skill whenever working on image generation in Opollo — Ideogram API calls, compositing (text and logo overlay), stock image fallback, mood board generation, quality checks, or prompt template construction. Trigger on any work in lib/image/, app/customer/image/, app/api/image/, or any mention of Ideogram, compositing, mood board, background generation, or image style in the Opollo codebase. Image generation has specific patterns around brand integration, prompt governance, failure handling, quality checks, and compositing abstraction that are easy to get wrong — read this before reaching for generic AI image API patterns.
---

# Image Generation

Opollo uses Ideogram for background-only image generation and a compositing provider (Bannerbear or Placid) for programmatic text and logo overlay. The two concerns are permanently separated.

## The rules — all non-negotiable

1. **Backgrounds only.** Ideogram generates backgrounds. Text is NEVER in a prompt or in the generated image.
2. **No free-form prompts.** Only parameterised inputs. No text field exposed to users.
3. **Composition → text zone is deterministic.** See the mapping table below. No variation.
4. **Brand from brand profile.** `get_active_brand_profile(companyId)` always. Never ad-hoc.
5. **Every call writes to image_generation_log.** No exceptions.
6. **compositeImage() is the only compositing call.** Never call Bannerbear or Placid directly.
7. **Quality check before showing to user.** Luminance + safe zone + dimension.
8. **Failure handler on every generation call.** quality fail → retry → stock → escalate.
9. **safe_mode=true blocks bold_promo and editorial entirely.** Not just de-prioritised — removed.
10. **Store in Supabase Storage immediately.** Ideogram URLs are ephemeral. Download on receipt.
11. **Use lib/logger.ts.** Never console.log.
12. **Email via dispatch().** Never import @sendgrid/mail.

---

## Deterministic composition → text zone mapping

This is the most important table in this skill. The composition type determines exactly where the text zone sits. There is NO flexibility here — if the generation prompt says `split_layout`, the text zone is always on the right third. This is what makes outputs predictable.

| Composition type | Text zone position | Text zone size | Safe overlay colour |
|------------------|--------------------|----------------|---------------------|
| `split_layout` | Right 40%, vertically centred (y: 15–85%, x: 58–95%) | 37% width | Determined by luminance check |
| `gradient_fade` | Left 40%, vertically centred (y: 15–85%, x: 5–42%) | 37% width | Determined by luminance check |
| `full_background` | Bottom 30% (y: 68–92%, x: 5–95%) | 90% width | Dark overlay always |
| `geometric` | Centre (y: 25–75%, x: 20–80%) | 60% width | Determined by luminance check |
| `texture` | Centre (y: 20–80%, x: 15–85%) | 70% width | Determined by luminance check |

The compositing provider receives these coordinates directly — not suggestions. Text zones are not adjusted based on what looks good; they are fixed by composition type.

```typescript
// lib/image/compositing/text-zones.ts
export const TEXT_ZONE_MAP: Record<CompositionType, TextZone> = {
  split_layout:    { x: 58, y: 15, width: 37, height: 70, alignment: 'left' },
  gradient_fade:   { x: 5,  y: 15, width: 37, height: 70, alignment: 'left' },
  full_background: { x: 5,  y: 68, width: 90, height: 24, alignment: 'center' },
  geometric:       { x: 20, y: 25, width: 60, height: 50, alignment: 'center' },
  texture:         { x: 15, y: 20, width: 70, height: 60, alignment: 'center' },
};
// All values in percent of image dimensions
```

---

## Ideogram API client

```typescript
// lib/image/generator/ideogram.ts
import { logger } from '@/lib/logger';

const GLOBAL_NEGATIVE_PROMPT = [
  'text', 'words', 'letters', 'typography', 'watermark', 'logo', 'signature',
  'caption', 'label', 'title', 'heading', 'font', 'written',
  'blurry', 'distorted', 'low quality', 'pixelated', 'noisy',
].join(', ');

export async function generateBackground(params: {
  styleId: StyleId;
  primaryColour: string;
  compositionType: CompositionType;
  aspectRatio: AspectRatio;
  model?: 'standard' | 'premium';
  count?: number;
  companyId: string;            // for logging
}): Promise<GeneratedImage[]> {
  const prompt = buildPrompt(params);
  const model = params.model === 'premium'
    ? process.env.IDEOGRAM_PREMIUM_MODEL!    // ideogram-ai/ideogram-v3
    : process.env.IDEOGRAM_STANDARD_MODEL!;  // ideogram-ai/ideogram-v3-flash

  const startMs = Date.now();

  try {
    const response = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': process.env.IDEOGRAM_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt,
          model,
          aspect_ratio: params.aspectRatio,
          num_images: params.count ?? 1,
          style_type: 'REALISTIC',
          negative_prompt: GLOBAL_NEGATIVE_PROMPT,
        }
      }),
      signal: AbortSignal.timeout(parseInt(process.env.IMAGE_GENERATION_TIMEOUT_MS ?? '30000')),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('Ideogram API error', { status: response.status, body, styleId: params.styleId, companyId: params.companyId });
      throw new IdeogramError(response.status, body);
    }

    const data = await response.json();
    logger.info('Ideogram generation success', {
      model, styleId: params.styleId, count: data.data.length,
      durationMs: Date.now() - startMs, companyId: params.companyId,
    });
    return data.data.map(mapToGeneratedImage);

  } catch (err) {
    if (err instanceof IdeogramError) throw err;
    logger.error('Ideogram request failed', { error: String(err), companyId: params.companyId });
    throw new IdeogramError(0, String(err));
  }
}

export function isRetryable(err: IdeogramError): boolean {
  return err.status === 429 || err.status >= 500 || err.status === 0;
}
```

---

## Prompt template engine — parameterised only

```typescript
// lib/image/generator/prompt-engine.ts

export type StyleId = 'clean_corporate' | 'bold_promo' | 'minimal_modern' | 'editorial' | 'product_focus';
export type CompositionType = 'split_layout' | 'gradient_fade' | 'full_background' | 'geometric' | 'texture';
export type AspectRatio = 'ASPECT_1_1' | 'ASPECT_4_5' | 'ASPECT_16_9' | 'ASPECT_9_16';

interface PromptParams {
  styleId: StyleId;
  primaryColour: string;
  compositionType: CompositionType;
  industry?: string;
  mood?: string;
  safeMode?: boolean;
}

export function buildPrompt(params: PromptParams): string {
  const base = STYLE_BASES[params.styleId];
  const composition = COMPOSITION_MODIFIERS[params.compositionType];
  const colourDesc = hexToColourDescription(params.primaryColour);
  const industryCtx = params.industry ? INDUSTRY_MODIFIERS[params.industry] ?? '' : '';
  const safeMod = params.safeMode ? 'photographic realism, stock photography style, ' : '';
  const moodMod = params.mood ? `${params.mood} mood, ` : '';

  return `${safeMod}${moodMod}${base}, ${composition}, ${colourDesc} colour accent, ${industryCtx}, no text, no words, no letters, no typography`.trim();
}

const STYLE_BASES: Record<StyleId, string> = {
  clean_corporate:  'professional corporate background, clean geometric lines, minimal modern elements, business aesthetic',
  bold_promo:       'high-contrast promotional background, dynamic diagonal composition, energetic graphic rhythm, bold visual design',
  minimal_modern:   'minimalist background, generous negative space, single subtle accent element, premium contemporary feel',
  editorial:        'sophisticated editorial background, layered depth, journalistic composition, muted sophisticated tones',
  product_focus:    'clean studio background, soft gradient, professional product photography environment, neutral tones',
};

const COMPOSITION_MODIFIERS: Record<CompositionType, string> = {
  split_layout:    'asymmetric composition — left two-thirds rich, right third light and open for text',
  gradient_fade:   'gradient from rich left edge fading to light on right — left side clear for text overlay',
  full_background:'full-frame background with darker lower third suitable for text',
  geometric:       'subtle geometric shapes concentrated in upper corners, clear central zone',
  texture:         'even textured surface, consistent lighting throughout, clear content zone',
};
```

---

## Quality check — rules-based, not AI

Run before showing any image to users. All three checks must pass.

```typescript
// lib/image/failure/quality-check.ts
import sharp from 'sharp';
import { logger } from '@/lib/logger';

interface QualityResult {
  passed: boolean;
  luminanceScore: number;   // average luminance in text zone (0–255)
  safeZoneScore: number;    // Laplacian variance in centre (lower = simpler/safer)
  reason?: string;
}

export async function qualityCheck(
  imageBuffer: Buffer,
  compositionType: CompositionType
): Promise<QualityResult> {
  const image = sharp(imageBuffer);
  const { width, height } = await image.metadata();

  if (!width || !height) {
    return { passed: false, luminanceScore: 0, safeZoneScore: 0, reason: 'Cannot read image dimensions' };
  }

  // Check 1: file size (blank images are near-zero)
  if (imageBuffer.length < 50_000) {
    return { passed: false, luminanceScore: 0, safeZoneScore: 0, reason: 'Image too small (possible blank)' };
  }

  const zone = TEXT_ZONE_MAP[compositionType];

  // Check 2: Luminance in text zone — is it suitable for text overlay?
  const zoneLeft   = Math.floor((zone.x / 100) * width);
  const zoneTop    = Math.floor((zone.y / 100) * height);
  const zoneWidth  = Math.floor((zone.width / 100) * width);
  const zoneHeight = Math.floor((zone.height / 100) * height);

  const zonePixels = await image
    .extract({ left: zoneLeft, top: zoneTop, width: zoneWidth, height: zoneHeight })
    .greyscale()
    .raw()
    .toBuffer();

  const luminanceScore = zonePixels.reduce((sum, p) => sum + p, 0) / zonePixels.length;
  // Suitable for white text: luminance < 160 (dark enough)
  // Suitable for dark text: luminance > 180 (light enough)
  // Middle zone (160–180): use a semi-transparent overlay
  const luminanceOk = luminanceScore < 160 || luminanceScore > 180;

  // Check 3: Safe zone clarity — centre of image should not be too busy
  // High Laplacian variance = lots of detail/noise = bad for text
  const centreLeft   = Math.floor(width * 0.25);
  const centreTop    = Math.floor(height * 0.25);
  const centreWidth  = Math.floor(width * 0.5);
  const centreHeight = Math.floor(height * 0.5);

  const centrePixels = await image
    .extract({ left: centreLeft, top: centreTop, width: centreWidth, height: centreHeight })
    .greyscale()
    .raw()
    .toBuffer();

  // Approximate Laplacian variance (edge detection proxy)
  const safeZoneScore = computeLaplacianVariance(centrePixels, centreWidth, centreHeight);
  const safeZoneOk = safeZoneScore < 2500;  // threshold: tune based on real outputs

  const passed = luminanceOk && safeZoneOk;

  if (!passed) {
    logger.info('Quality check failed', {
      compositionType, luminanceScore, safeZoneScore,
      luminanceOk, safeZoneOk,
    });
  }

  return {
    passed,
    luminanceScore,
    safeZoneScore,
    reason: !passed ? `luminance: ${luminanceScore.toFixed(0)}, safeZone: ${safeZoneScore.toFixed(0)}` : undefined,
  };
}

// Overlay colour decision based on luminance
export function selectOverlayColour(luminanceScore: number): 'white' | 'dark' | 'overlay' {
  if (luminanceScore < 160) return 'white';
  if (luminanceScore > 180) return 'dark';
  return 'overlay';  // semi-transparent dark band behind text
}

function computeLaplacianVariance(pixels: Buffer, width: number, height: number): number {
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = Math.abs(
        -pixels[i - width - 1] - pixels[i - width] - pixels[i - width + 1]
        - pixels[i - 1] + 8 * pixels[i] - pixels[i + 1]
        - pixels[i + width - 1] - pixels[i + width] - pixels[i + width + 1]
      );
      sum += lap; sumSq += lap * lap; count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}
```

---

## Failure handler — every generation call goes through this

```typescript
// lib/image/failure/handler.ts
import { logger } from '@/lib/logger';
import { dispatch } from '@/lib/platform/notifications/dispatch';

export async function generateWithFallback(params: GenerationParams): Promise<GeneratedImage[]> {
  const logBase = { companyId: params.companyId, styleId: params.styleId, compositionType: params.compositionType };

  // Attempt 1
  try {
    const images = await generateBackground(params);
    const stored  = await downloadAndStore(images, params.companyId);
    const checks  = await Promise.all(stored.map(img => qualityCheck(img.buffer, params.compositionType)));
    const passed  = stored.filter((_, i) => checks[i].passed);

    if (passed.length > 0) {
      await writeImageLog({ ...logBase, outcome: 'success', retryCount: 0, qualityCheck: checks[0] });
      return passed;
    }

    logger.warn('Quality check failed on attempt 1', logBase);
  } catch (err) {
    if (err instanceof IdeogramError && !isRetryable(err)) {
      logger.warn('Non-retryable Ideogram error', { ...logBase, status: err.status });
      return await stockFallbackWithLog(params, logBase);
    }
    logger.warn('Retryable error on attempt 1', { ...logBase, error: String(err) });
  }

  // Attempt 2 — simplified prompt (remove optional modifiers)
  try {
    const images = await generateBackground({ ...params, simplifyPrompt: true });
    const stored  = await downloadAndStore(images, params.companyId);
    const checks  = await Promise.all(stored.map(img => qualityCheck(img.buffer, params.compositionType)));
    const passed  = stored.filter((_, i) => checks[i].passed);

    if (passed.length > 0) {
      await writeImageLog({ ...logBase, outcome: 'retry_success', retryCount: 1, qualityCheck: checks[0] });
      return passed;
    }
  } catch (_) {
    logger.warn('Attempt 2 failed', logBase);
  }

  // Stock fallback
  return await stockFallbackWithLog(params, logBase);
}

async function stockFallbackWithLog(params: GenerationParams, logBase: object): Promise<GeneratedImage[]> {
  try {
    const stock = await stockFallback(params);
    await writeImageLog({ ...logBase, outcome: 'stock_fallback', retryCount: 1, fallbackUsed: true });
    return stock;
  } catch (_) {
    await escalateToHuman(params);
    await writeImageLog({ ...logBase, outcome: 'escalated', retryCount: 1, fallbackUsed: true });
    throw new ImageGenerationError('Generation failed after all attempts — Opollo staff notified');
  }
}

async function escalateToHuman(params: GenerationParams): Promise<void> {
  await dispatch('image_generation_failed', [
    { email: process.env.PLATFORM_ADMIN_ALERT_EMAILS! }
  ], {
    companyId: params.companyId,
    styleId: params.styleId,
    timestamp: new Date().toISOString(),
  });
}
```

---

## Stock fallback — ranked selection

```typescript
// lib/image/generator/stock.ts
export async function stockFallback(params: GenerationParams): Promise<GeneratedImage[]> {
  const supabase = getServiceRoleClient();

  // Fetch candidates
  const { data: candidates } = await supabase
    .from('image_stock_library')
    .select('*')
    .eq('deleted_at', null)
    .in('style_id', [params.styleId, 'neutral'])    // exact style match or neutral fallback
    .limit(20);

  if (!candidates?.length) {
    throw new StockUnavailableError('No stock images available');
  }

  // Rank by: style match (3pt) + industry match (2pt) + luminance suitability (2pt)
  const ranked = candidates.map(img => ({
    img,
    score:
      (img.style_id === params.styleId ? 3 : 0) +
      (params.industry && img.industry_tags?.includes(params.industry) ? 2 : 0) +
      (img.luminance_score !== null
        ? img.luminance_score < 160 || img.luminance_score > 180 ? 2 : 0
        : 1),    // unknown luminance = neutral score
  })).sort((a, b) => b.score - a.score);

  return [mapStockToGeneratedImage(ranked[0].img)];
}
```

---

## Audit log — write on every call

```typescript
// lib/image/failure/handler.ts
async function writeImageLog(params: {
  companyId: string;
  brandProfileId?: string;
  brandProfileVersion?: number;
  styleId: string;
  compositionType: string;
  aspectRatio: string;
  modelUsed?: string;
  modelTier?: string;
  promptUsed?: string;
  outcome: string;
  retryCount: number;
  fallbackUsed?: boolean;
  compositingProvider?: string;
  backgroundStoragePath?: string;
  outputStoragePath?: string;
  postMasterId?: string;
  qualityCheck?: { passed: boolean; luminanceScore: number; safeZoneScore: number };
  errorClass?: string;
  errorDetail?: string;
  generationDurationMs?: number;
  compositingDurationMs?: number;
  triggeredBy?: string;
}): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from('image_generation_log').insert({
    company_id:               params.companyId,
    brand_profile_id:         params.brandProfileId,
    brand_profile_version:    params.brandProfileVersion,
    style_id:                 params.styleId,
    composition_type:         params.compositionType,
    aspect_ratio:             params.aspectRatio,
    model_used:               params.modelUsed ?? 'unknown',
    model_tier:               params.modelTier ?? 'standard',
    prompt_used:              params.promptUsed ?? '',
    outcome:                  params.outcome,
    retry_count:              params.retryCount,
    fallback_used:            params.fallbackUsed ?? false,
    compositing_provider:     params.compositingProvider,
    quality_check_passed:     params.qualityCheck?.passed,
    luminance_score:          params.qualityCheck?.luminanceScore,
    safe_zone_score:          params.qualityCheck?.safeZoneScore,
    background_storage_path:  params.backgroundStoragePath,
    output_storage_path:      params.outputStoragePath,
    post_master_id:           params.postMasterId,
    error_class:              params.errorClass,
    error_detail:             params.errorDetail,
    generation_duration_ms:   params.generationDurationMs,
    compositing_duration_ms:  params.compositingDurationMs,
    triggered_by:             params.triggeredBy,
  });

  if (error) {
    // Log failure to write log — never let this crash the generation flow
    logger.error('Failed to write image_generation_log', { error: error.message, companyId: params.companyId });
  }
}
```

---

## compositeImage() — the only compositing call

Product code never calls Bannerbear or Placid directly.

```typescript
// lib/image/compositing/index.ts

export interface TextZone {
  text: string;
  x: number; y: number;           // percent of image dimensions
  width: number; height: number;  // percent
  maxFontSize: number;
  fontFamily?: string;
  colour: 'white' | 'dark' | 'overlay';
  alignment: 'left' | 'center' | 'right';
}

export interface LogoConfig {
  url: string;                    // fresh signed URL — generate at call time, not upload time
  position: 'top-right' | 'bottom-right' | 'bottom-left' | 'watermark-center';
  sizePercent: number;
  padding: number;
}

export interface CompositeInput {
  backgroundStoragePath: string;  // Supabase Storage path of background
  textZones: TextZone[];          // from TEXT_ZONE_MAP for the composition type
  logo: LogoConfig | null;
  outputFormat: 'jpeg' | 'png';
  outputWidth: number;
  outputHeight: number;
}

export async function compositeImage(input: CompositeInput): Promise<{ storagePath: string; provider: string; durationMs: number }> {
  const provider = process.env.COMPOSITING_PROVIDER ?? 'bannerbear';
  switch (provider) {
    case 'bannerbear': return compositeBannerbear(input);
    case 'placid':     return compositePlacid(input);
    case 'sharp':      return compositeSharp(input);
    default: throw new Error(`Unknown compositing provider: ${provider}`);
  }
}
```

Generate fresh signed URLs for logos immediately before the compositing call (not at upload time — post could be weeks old):

```typescript
const logoSignedUrl = brand.logo_icon_url
  ? await supabase.storage.from(SOCIAL_MEDIA_BUCKET).createSignedUrl(brand.logo_icon_url, 3600)
  : null;
```

---

## safe_mode enforcement

```typescript
// lib/image/generator/routing.ts
import { filterStylesForBrand } from '@/lib/platform/brand';

const SAFE_MODE_BLOCKED_STYLES: StyleId[] = ['bold_promo', 'editorial'];

export function validateStyleForBrand(styleId: StyleId, brand: BrandProfile | null): void {
  if (brand?.safe_mode && SAFE_MODE_BLOCKED_STYLES.includes(styleId)) {
    throw new StyleBlockedError(`${styleId} is not available for this client (safe_mode is on)`);
  }
  if (brand?.approved_style_ids?.length && !brand.approved_style_ids.includes(styleId)) {
    throw new StyleBlockedError(`${styleId} is not in this client's approved style list`);
  }
}

// The UI must only show allowed styles — call this to get the filtered list
export function getAllowedStyles(brand: BrandProfile | null): StyleId[] {
  const all: StyleId[] = ['clean_corporate', 'bold_promo', 'minimal_modern', 'editorial', 'product_focus'];
  if (!brand) return all;

  let allowed = brand.approved_style_ids?.length ? brand.approved_style_ids as StyleId[] : all;
  if (brand.safe_mode) {
    allowed = allowed.filter(s => !SAFE_MODE_BLOCKED_STYLES.includes(s));
  }
  return allowed;
}
```

---

## Standard vs premium routing

```typescript
// lib/image/generator/routing.ts
export function selectModelTier(company: CompanySettings, context: GenerationContext): 'standard' | 'premium' {
  if (company.is_high_value) return 'premium';
  if (context.isCampaign) return 'premium';
  if (context.previousRejectionCount >= 2) return 'premium';
  return 'standard';
}
// standard → IDEOGRAM_STANDARD_MODEL (3.0 Flash, $0.03)
// premium  → IDEOGRAM_PREMIUM_MODEL  (3.0 Default, $0.06)
// Model selection is internal. Never expose to users.
```

---

## Aspect ratios by platform

| Platform | Aspect | Ideogram param |
|----------|--------|----------------|
| LinkedIn feed | 1:1 or 4:5 | ASPECT_1_1 / ASPECT_4_5 |
| Facebook Page | 1.91:1 | ASPECT_16_9 |
| X (Twitter) | 16:9 or 1:1 | ASPECT_16_9 / ASPECT_1_1 |
| GBP | 4:3 | ASPECT_4_5 (closest) |
| Instagram Story | 9:16 | ASPECT_9_16 |

---

## CSP — new domains must be allowlisted

Before calling any external image API, add its domain to `lib/security-headers.ts` `connect-src`:

```
api.ideogram.ai          — Ideogram API
api.bannerbear.com       — Bannerbear compositing (if selected)
api.placid.app           — Placid compositing (if selected)
```

The static audit (`npm run audit:static`) checks CSP coverage and blocks CI on missing entries.

---

## Environment variables

```
IDEOGRAM_API_KEY=
IDEOGRAM_STANDARD_MODEL=ideogram-ai/ideogram-v3-flash
IDEOGRAM_PREMIUM_MODEL=ideogram-ai/ideogram-v3
IMAGE_GENERATION_TIMEOUT_MS=30000
COMPOSITING_PROVIDER=bannerbear        # or placid or sharp
BANNERBEAR_API_KEY=
PLACID_API_KEY=
IMAGE_GENERATION_BUCKET=generated-images
SOCIAL_MEDIA_BUCKET=social-media
```

---

## What lives where

```
lib/image/
  generator/
    ideogram.ts           — Ideogram API client (backgrounds only)
    prompt-engine.ts      — parameterised prompt builder
    stock.ts              — stock library client + ranking
    routing.ts            — model tier selection, style validation, getAllowedStyles
  compositing/
    index.ts              — compositeImage() abstraction interface
    text-zones.ts         — TEXT_ZONE_MAP (deterministic composition→zone mapping)
    bannerbear.ts         — Bannerbear implementation
    placid.ts             — Placid implementation
    sharp.ts              — Sharp implementation (future)
  failure/
    quality-check.ts      — luminance, safe zone, dimension checks
    handler.ts            — generateWithFallback(), escalation, audit log write
  types.ts                — StyleId, CompositionType, AspectRatio, GeneratedImage, etc.
```

## Common pitfalls

- **Never include text in Ideogram prompts.** GLOBAL_NEGATIVE_PROMPT enforces this at API level. The human rule: prompt describes a visual scene, never describes copy.
- **Never hardcode text zone coordinates.** Always use TEXT_ZONE_MAP[compositionType].
- **Never call compositing providers directly.** compositeImage() only.
- **Never skip quality check.** Show no image before it passes.
- **Never skip image_generation_log write.** Even on failure — log the failure.
- **Never use Ideogram URLs directly.** Download to Supabase Storage on receipt.
- **Never generate without checking getAllowedStyles().** Respect safe_mode and approved_style_ids.
- **Never use upload-time signed URLs.** Generate fresh signed URLs at compositing time.
- **Never use console.log.** lib/logger.ts only.
- **Never import @sendgrid/mail.** Use dispatch() for escalation notifications.
