---
name: platform-brand-governance
description: Use this skill whenever working on brand profiles, product subscriptions, or anything that reads brand data in the Opollo platform. Trigger on any work in lib/platform/brand/, app/customer/settings/brand/, app/admin/platform/, any reference to platform_brand_profiles or platform_product_subscriptions, or any time a product layer needs brand colours, logos, tone of voice, style approvals, or content rules. Also trigger when writing image generation prompts, compositing configurations, or CAP copy generation — all of these read from the brand profile. Brand data never lives in product-specific config — it always comes from this layer.
---

# Platform Brand Governance

The brand profile is the single source of truth for how a client's brand looks, sounds, and behaves across every Opollo product. No product owns brand data. Every product reads it.

## Core rules

- **Never store brand data in product-specific tables.** Not in social, not in image generation, not in CAP.
- **Never pass brand config as ad-hoc parameters.** Always read from `get_active_brand_profile(companyId)`.
- **Never UPDATE platform_brand_profiles directly.** Always call `update_brand_profile()` RPC.
- **Always stamp generated content with brand_profile_id + brand_profile_version.**

## Reading the active brand profile

```typescript
// lib/platform/brand/index.ts
import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export async function get_active_brand_profile(companyId: string): Promise<BrandProfile | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from('platform_brand_profiles')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .single();

  if (error) {
    logger.error('Failed to fetch brand profile', { companyId, error: error.message });
    return null;
  }
  return data;
}
```

Degrade gracefully when brand is missing — never throw because brand is incomplete. Products work at reduced quality and surface a completion prompt.

## Checking product access

```typescript
// lib/platform/brand/subscriptions.ts
import { getServiceRoleClient } from '@/lib/supabase';

export async function can_access_product(
  companyId: string,
  product: 'site_builder' | 'social' | 'cap' | 'blog' | 'email'
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { count } = await supabase
    .from('platform_product_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('product', product)
    .eq('is_active', true);
  return (count ?? 0) > 0;
}
```

Check at the route boundary. Opollo staff bypass this check.

## Updating the brand profile — versioning pattern

NEVER call UPDATE on `platform_brand_profiles`. Always use the RPC. It deactivates the current version and inserts a new one transactionally.

```typescript
// lib/platform/brand/update.ts
import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export async function update_brand_profile(
  companyId: string,
  updatedBy: string,
  fields: Partial<BrandProfile>,
  changeSummary: string
): Promise<BrandProfile> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc('update_brand_profile', {
    p_company_id: companyId,
    p_updated_by: updatedBy,
    p_change_summary: changeSummary,
    p_fields: fields,
  });

  if (error) {
    logger.error('Brand profile update failed', { companyId, error: error.message });
    throw new Error('Brand profile update failed');
  }
  return data;
}
```

**Special rule for content_restrictions:** the app layer must verify the actor is Opollo staff before allowing changes to this field. Company admins cannot self-modify content_restrictions.

```typescript
// In the brand profile update route handler:
if (fields.content_restrictions !== undefined && !isOpolloStaff) {
  return new Response('content_restrictions requires Opollo staff approval', { status: 403 });
}
```

## Stamping generated content

Every post, page, or generated asset stores the brand version it was created against. Set at creation, never update.

```typescript
// lib/social/editorial/create-post.ts
import { get_active_brand_profile } from '@/lib/platform/brand';
import { logger } from '@/lib/logger';

const brand = await get_active_brand_profile(companyId);

if (!brand) {
  logger.warn('No active brand profile — creating post with null brand stamp', { companyId });
}

await supabase.from('social_post_master').insert({
  company_id: companyId,
  brand_profile_id: brand?.id ?? null,
  brand_profile_version: brand?.version ?? null,
  source_type: 'manual',
  // ... other fields
});
```

## Brand completion tiers

Products must degrade gracefully, not block, when brand is incomplete.

```typescript
// lib/platform/brand/completion.ts
export type BrandTier = 'none' | 'minimal' | 'standard' | 'complete';

export function getBrandTier(brand: BrandProfile | null): BrandTier {
  if (!brand) return 'none';

  const hasMinimal = !!(brand.primary_colour && brand.logo_primary_url);
  if (!hasMinimal) return 'none';

  const hasStandard = !!(
    brand.industry && brand.formality &&
    brand.personality_traits?.length > 0 &&
    brand.focus_topics?.length > 0
  );
  if (!hasStandard) return 'minimal';

  const hasComplete = !!(
    brand.voice_examples?.length > 0 &&
    brand.platform_overrides &&
    Object.keys(brand.platform_overrides).length > 0 &&
    brand.image_style && Object.keys(brand.image_style).length > 0
  );
  return hasComplete ? 'complete' : 'standard';
}
```

Show completion prompt in UI for `none` or `minimal`. Never block product use.

## Graceful degradation patterns

```typescript
const brand = await get_active_brand_profile(companyId);

// Compositing: fall back to neutral colour if no primary
const primaryColour = brand?.primary_colour ?? '#6B7280';

// Logo: check each variant before using; some clients only have logo_primary_url
const logoUrl = brand?.logo_icon_url ?? brand?.logo_primary_url ?? null;
const shouldOverlayLogo = logoUrl !== null;

// CAP: use generic tone if voice fields empty
const personalityTraits = brand?.personality_traits?.length
  ? brand.personality_traits
  : ['professional', 'helpful'];

// safe_mode: default false if no profile
const safeMode = brand?.safe_mode ?? false;

// Approved styles: empty array = all approved
const approvedStyles = brand?.approved_style_ids?.length
  ? brand.approved_style_ids
  : ALL_STYLE_IDS;
```

## safe_mode enforcement

When `safe_mode = true`:

```typescript
// lib/image/generator/routing.ts
const SAFE_MODE_BLOCKED_STYLES: StyleId[] = ['bold_promo', 'editorial'];
const SAFE_MODE_ALLOWED_COMPOSITIONS: CompositionType[] = ['full_background', 'gradient_fade', 'texture'];

export function filterStylesForBrand(brand: BrandProfile | null): StyleId[] {
  const approved = brand?.approved_style_ids?.length ? brand.approved_style_ids : ALL_STYLE_IDS;
  if (brand?.safe_mode) {
    return approved.filter(s => !SAFE_MODE_BLOCKED_STYLES.includes(s as StyleId));
  }
  return approved;
}
```

The UI must not even show blocked styles when safe_mode is on — not grey them out, remove them entirely.

## Per-product field consumption

| Field | Social | Image Gen | CAP |
|-------|--------|-----------|-----|
| primary_colour | Compositing bg | Prompt param + compositing | — |
| logo_icon_url / logo_light_url | — | Logo overlay | — |
| approved_style_ids | Mood board filter | Style filter + UI | — |
| safe_mode | — | Style block + stock routing | — |
| image_style | — | Prompt guidance | — |
| personality_traits / formality / pov | — | — | System prompt |
| preferred_vocabulary / avoided_terms | — | — | Prompt constraints |
| voice_examples | — | — | Few-shot examples |
| focus_topics / avoided_topics | — | — | Content scope |
| content_restrictions | Hard filter | — | Hard filter |
| default_approval_required | Post defaults | — | — |
| platform_overrides | Composer defaults | — | — |
| hashtag_strategy / max_post_length | — | — | Post generation |

## RLS summary

- **Read:** any active company member can read their company's brand profile
- **Write:** company Admin or Opollo staff only (content_restrictions = staff only)
- **Product subscriptions:** Opollo staff write; company members read

```typescript
// Permission gate at route boundary
if (!(await canDo(companyId, 'manage_brand'))) {
  return new Response('Forbidden', { status: 403 });
}
```

## What lives where

```
lib/platform/brand/
  index.ts          — get_active_brand_profile(), can_access_product()
  update.ts         — update_brand_profile() (versioning wrapper)
  completion.ts     — getBrandTier()
  subscriptions.ts  — product subscription helpers
  types.ts          — BrandProfile TypeScript type

app/customer/settings/brand/
  page.tsx          — brand profile editor (Admin only)
  history/          — version history view

app/admin/platform/companies/[id]/
  brand/page.tsx    — Opollo staff brand management + version revert
```

## Common pitfalls

- **Don't UPDATE platform_brand_profiles directly.** Always call update_brand_profile() RPC.
- **Don't cache brand profiles in Node.js process memory.** Always fetch fresh. Short server-side cache (30s) is acceptable for high-frequency reads; in-process state is not.
- **Don't assume all logo variants exist.** Always check before using each variant.
- **Don't write brand data from lib/social/ or lib/image/.** Read-only access only.
- **Don't skip the brand version stamp.** Every generated artifact needs brand_profile_id + brand_profile_version.
- **Don't allow company admins to modify content_restrictions.** Server-side check required.
- **Don't use console.log.** Use `import { logger } from '@/lib/logger'`.
- **Don't call SendGrid directly.** Use dispatch() which routes through lib/email/sendgrid.ts.
- **Don't read brand from request body or ad-hoc config.** Always get_active_brand_profile(companyId).
