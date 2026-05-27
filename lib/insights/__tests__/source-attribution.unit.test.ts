import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase';
import { resolvePostSource } from '../source-attribution';

type MockClient = {
  from: ReturnType<typeof vi.fn>;
};

function buildChain(finalData: unknown, finalError?: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: finalData, error: finalError ?? null });
  return chain;
}

describe('resolvePostSource', () => {
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFrom = vi.fn();
    (getServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });
  });

  // -------------------------------------------------------------------------
  // V2 path — draft found in social_post_drafts via bundle_post_id
  // -------------------------------------------------------------------------

  it('returns cap when V2 draft has source_type=cap', async () => {
    mockFrom.mockReturnValue(buildChain({ source_type: 'cap' }));

    const result = await resolvePostSource('bundle-v2-cap');
    expect(result.source).toBe('cap');
    expect(result.capCampaignPostId).toBeNull();
    // Only one from() call — short-circuits before V1 chain
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom.mock.calls[0][0]).toBe('social_post_drafts');
  });

  it('returns composer when V2 draft has source_type=manual', async () => {
    mockFrom.mockReturnValue(buildChain({ source_type: 'manual' }));

    const result = await resolvePostSource('bundle-v2-manual');
    expect(result.source).toBe('composer');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('returns composer when V2 draft has source_type=null (pre-migration row)', async () => {
    mockFrom.mockReturnValue(buildChain({ source_type: null }));

    const result = await resolvePostSource('bundle-v2-null');
    expect(result.source).toBe('composer');
  });

  // -------------------------------------------------------------------------
  // V1 path — no V2 draft found, falls back to legacy chain
  // -------------------------------------------------------------------------

  it('returns composer when no draft or publish attempt found', async () => {
    // First call (social_post_drafts) returns null → fall through to V1
    mockFrom
      .mockReturnValueOnce(buildChain(null))  // social_post_drafts
      .mockReturnValue(buildChain(null));     // social_publish_attempts (null → composer)

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('returns composer when publish attempt has no post_variant_id', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain(null))                          // social_post_drafts
      .mockReturnValueOnce(buildChain({ post_variant_id: null }))    // social_publish_attempts
      .mockReturnValue(buildChain(null));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
  });

  it('returns composer when variant not found', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain(null))                               // social_post_drafts
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' })) // social_publish_attempts
      .mockReturnValueOnce(buildChain(null));                              // social_post_variant

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
  });

  it('returns composer when master source_type is manual', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain(null))
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'manual' }));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('returns cap when master source_type is cap (V1 chain)', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain(null))
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'cap' }));

    const result = await resolvePostSource('bundle-cap-001');
    expect(result.source).toBe('cap');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('queries tables in the correct order (V2 then V1 chain)', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain(null))
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'cap' }));

    await resolvePostSource('bundle-001');

    expect(mockFrom.mock.calls[0][0]).toBe('social_post_drafts');
    expect(mockFrom.mock.calls[1][0]).toBe('social_publish_attempts');
    expect(mockFrom.mock.calls[2][0]).toBe('social_post_variant');
    expect(mockFrom.mock.calls[3][0]).toBe('social_post_master');
  });
});
