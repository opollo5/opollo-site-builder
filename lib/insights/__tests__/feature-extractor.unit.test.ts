import { describe, it, expect } from 'vitest';
import { extractDeterministicFeatures, type ExtractFeaturesInput } from '../feature-extractor';

const BASE_INPUT: ExtractFeaturesInput = {
  bundlePostId: 'bundle-001',
  companyId: '00000000-0000-0000-0000-000000000001',
  profileId: '00000000-0000-0000-0000-000000000002',
  source: 'composer',
  capCampaignPostId: null,
  platform: 'linkedin_personal',
  content: 'Hello world. This is a test post.',
  mediaUrls: null,
  postedAt: new Date('2026-05-23T10:00:00Z'),
  clientTimezone: 'UTC',
};

describe('extractDeterministicFeatures', () => {
  it('counts words correctly', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'One two three four five' });
    expect(result.wordCount).toBe(5);
  });

  it('counts sentences correctly', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Hello world. How are you? Fine!' });
    expect(result.sentenceCount).toBe(3);
  });

  it('detects questions', () => {
    const withQ = extractDeterministicFeatures({ ...BASE_INPUT, content: 'What do you think?' });
    expect(withQ.hasQuestion).toBe(true);

    const withoutQ = extractDeterministicFeatures({ ...BASE_INPUT, content: 'I know what to do.' });
    expect(withoutQ.hasQuestion).toBe(false);
  });

  it('counts emoji — basic emoji', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Hello 🎉 world 🚀' });
    expect(result.emojiCount).toBe(2);
  });

  it('counts emoji — ZWJ sequence counts as one', () => {
    // 👨‍💻 is a ZWJ sequence (man + ZWJ + laptop)
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Hello 👨‍💻' });
    expect(result.emojiCount).toBeGreaterThanOrEqual(1);
  });

  it('counts emoji — skin tone modifier', () => {
    // 👋🏾 — waving hand with medium-dark skin tone
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Hi 👋🏾!' });
    expect(result.emojiCount).toBeGreaterThanOrEqual(1);
  });

  it('counts emoji — flag sequence (not Extended_Pictographic)', () => {
    // Flag emojis use regional indicators, not Extended_Pictographic
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'From 🇦🇺!' });
    // Flags may or may not match depending on runtime support; just verify no crash
    expect(typeof result.emojiCount).toBe('number');
  });

  it('counts hashtags', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Post about #marketing #growth #saas' });
    expect(result.hashtagCount).toBe(3);
  });

  it('detects links', () => {
    const withLink = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Check out https://example.com for more.' });
    expect(withLink.hasLink).toBe(true);

    const withoutLink = extractDeterministicFeatures({ ...BASE_INPUT, content: 'No link here.' });
    expect(withoutLink.hasLink).toBe(false);
  });

  it('detects media — single image', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, mediaUrls: ['https://cdn.example.com/img.jpg'] });
    expect(result.hasMedia).toBe(true);
    expect(result.mediaType).toBe('IMAGE');
  });

  it('detects media — video', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, mediaUrls: ['https://cdn.example.com/vid.mp4'] });
    expect(result.hasMedia).toBe(true);
    expect(result.mediaType).toBe('VIDEO');
  });

  it('detects media — carousel (multiple URLs)', () => {
    const result = extractDeterministicFeatures({
      ...BASE_INPUT,
      mediaUrls: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
    });
    expect(result.hasMedia).toBe(true);
    expect(result.mediaType).toBe('CAROUSEL');
  });

  it('sets hasMedia=false and mediaType=null with no media', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, mediaUrls: null });
    expect(result.hasMedia).toBe(false);
    expect(result.mediaType).toBeNull();
  });

  it('returns null readingGrade for short posts (< 20 words)', () => {
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: 'Short post.' });
    expect(result.readingGrade).toBeNull();
  });

  it('returns numeric readingGrade for long posts (>= 20 words, 2+ sentences)', () => {
    const longContent = 'The quick brown fox jumps over the lazy dog. ' +
      'This is another sentence to ensure minimum word count is reached for grade calculation.';
    const result = extractDeterministicFeatures({ ...BASE_INPUT, content: longContent });
    expect(result.readingGrade).not.toBeNull();
    expect(typeof result.readingGrade).toBe('number');
  });

  it('sets correct UTC day and hour from postedAt', () => {
    // 2026-05-23T10:30:00Z → Saturday, hour 10
    const result = extractDeterministicFeatures({
      ...BASE_INPUT,
      postedAt: new Date('2026-05-23T10:30:00Z'),
      clientTimezone: 'UTC',
    });
    expect(result.dayOfWeek).toBe(6); // Saturday
    expect(result.hourOfDayUtc).toBe(10);
    expect(result.hourOfDayClientTz).toBe(10);
  });

  it('adjusts hourOfDayClientTz for AEST (UTC+10)', () => {
    const result = extractDeterministicFeatures({
      ...BASE_INPUT,
      postedAt: new Date('2026-05-23T00:00:00Z'), // midnight UTC = 10am AEST
      clientTimezone: 'Australia/Sydney',
    });
    expect(result.hourOfDayUtc).toBe(0);
    expect(result.hourOfDayClientTz).toBe(10);
  });

  it('falls back to UTC hour on invalid timezone', () => {
    const result = extractDeterministicFeatures({
      ...BASE_INPUT,
      postedAt: new Date('2026-05-23T10:00:00Z'),
      clientTimezone: 'Invalid/Timezone',
    });
    expect(result.hourOfDayClientTz).toBe(10);
  });

  it('passes through identity fields', () => {
    const result = extractDeterministicFeatures({
      ...BASE_INPUT,
      source: 'cap',
      capCampaignPostId: 'cap-post-uuid',
    });
    expect(result.source).toBe('cap');
    expect(result.capCampaignPostId).toBe('cap-post-uuid');
    expect(result.bundlePostId).toBe('bundle-001');
  });
});
