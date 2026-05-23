import { describe, it, expectTypeOf } from 'vitest';
import type { InsPostFeatures, InsClientMemory, InsRecommendation } from '../types';

describe('Insights types', () => {
  it('InsPostFeatures matches expected shape', () => {
    const fixture: InsPostFeatures = {
      id: 'uuid',
      companyId: 'uuid',
      profileId: 'uuid',
      source: 'cap',
      bundlePostId: 'bundle-id',
      capCampaignPostId: null,
      platform: 'LINKEDIN',
      wordCount: 100,
      sentenceCount: 5,
      hasQuestion: false,
      emojiCount: 0,
      hashtagCount: 2,
      hasLink: false,
      hasMedia: false,
      mediaType: null,
      readingGrade: 8.5,
      dayOfWeek: 1,
      hourOfDayUtc: 10,
      hourOfDayClientTz: 21,
      sentimentScore: null,
      topicTags: null,
      postedAt: '2026-05-23T10:00:00Z',
      extractedAt: '2026-05-23T10:15:00Z',
      createdAt: '2026-05-23T10:15:00Z',
      updatedAt: '2026-05-23T10:15:00Z',
    };
    expectTypeOf(fixture).toMatchTypeOf<InsPostFeatures>();
  });

  it('InsClientMemory matches expected shape', () => {
    const fixture: InsClientMemory = {
      id: 'uuid',
      companyId: 'uuid',
      memoryType: 'winning_pattern',
      payload: { key: 'value' },
      strikes: 0,
      lastObservedAt: '2026-05-23T10:00:00Z',
      createdAt: '2026-05-23T10:00:00Z',
      updatedAt: '2026-05-23T10:00:00Z',
    };
    expectTypeOf(fixture).toMatchTypeOf<InsClientMemory>();
  });

  it('InsRecommendation matches expected shape', () => {
    const fixture: InsRecommendation = {
      id: 'uuid',
      companyId: 'uuid',
      platform: 'LINKEDIN',
      recommendationType: 'posting_time',
      headline: 'Post on Tuesday mornings',
      body: 'Your Tuesday 9am posts get 3x engagement.',
      successMetric: 'engagement_rate',
      confidenceScore: 0.85,
      confidenceBand: 'strong',
      evidenceRefs: [],
      suppressed: false,
      generatedAt: '2026-05-23T10:00:00Z',
      expiresAt: '2026-06-23T10:00:00Z',
    };
    expectTypeOf(fixture).toMatchTypeOf<InsRecommendation>();
  });
});
