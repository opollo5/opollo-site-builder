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

  it('returns composer when no publish attempt found', async () => {
    mockFrom.mockReturnValue(buildChain(null));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('returns composer when publish attempt has no post_variant_id', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ post_variant_id: null }))
      .mockReturnValue(buildChain(null));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
  });

  it('returns composer when variant not found', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain(null));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
  });

  it('returns composer when master source_type is manual', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'manual' }));

    const result = await resolvePostSource('bundle-001');
    expect(result.source).toBe('composer');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('returns cap when master source_type is cap', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'cap' }));

    const result = await resolvePostSource('bundle-cap-001');
    expect(result.source).toBe('cap');
    expect(result.capCampaignPostId).toBeNull();
  });

  it('queries tables in the correct order', async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ post_variant_id: 'variant-uuid' }))
      .mockReturnValueOnce(buildChain({ post_master_id: 'master-uuid' }))
      .mockReturnValueOnce(buildChain({ source_type: 'cap' }));

    await resolvePostSource('bundle-001');

    expect(mockFrom.mock.calls[0][0]).toBe('social_publish_attempts');
    expect(mockFrom.mock.calls[1][0]).toBe('social_post_variant');
    expect(mockFrom.mock.calls[2][0]).toBe('social_post_master');
  });
});
