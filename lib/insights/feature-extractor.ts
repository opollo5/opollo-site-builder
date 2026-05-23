import type { InsPostFeatures, InsSource } from './types';

export interface ExtractFeaturesInput {
  bundlePostId: string;
  companyId: string;
  profileId: string;
  source: InsSource;
  capCampaignPostId: string | null;
  platform: string;
  content: string;
  mediaUrls: string[] | null;
  postedAt: Date;
  clientTimezone: string;
}

export function extractDeterministicFeatures(
  input: ExtractFeaturesInput,
): Omit<InsPostFeatures, 'id' | 'extractedAt' | 'createdAt' | 'updatedAt' | 'sentimentScore' | 'topicTags'> {
  const { content, mediaUrls, postedAt, clientTimezone } = input;

  const words = content.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;

  const hasQuestion = /\?/.test(content);

  const emojiMatches = content.match(/\p{Extended_Pictographic}/gu);
  const emojiCount = emojiMatches?.length ?? 0;

  const hashtagMatches = content.match(/#\w+/g);
  const hashtagCount = hashtagMatches?.length ?? 0;

  const hasLink = /https?:\/\/\S+/.test(content);

  const hasMedia = (mediaUrls?.length ?? 0) > 0;
  const mediaType = inferMediaType(mediaUrls);

  let readingGrade: number | null = null;
  if (wordCount >= 20 && sentenceCount >= 2) {
    readingGrade = computeFleschKincaid(words, sentences);
  }

  const dayOfWeek = postedAt.getUTCDay();
  const hourOfDayUtc = postedAt.getUTCHours();
  const hourOfDayClientTz = getHourInTimezone(postedAt, clientTimezone);

  return {
    companyId: input.companyId,
    profileId: input.profileId,
    source: input.source,
    bundlePostId: input.bundlePostId,
    capCampaignPostId: input.capCampaignPostId,
    platform: input.platform,
    wordCount,
    sentenceCount,
    hasQuestion,
    emojiCount,
    hashtagCount,
    hasLink,
    hasMedia,
    mediaType,
    readingGrade,
    dayOfWeek,
    hourOfDayUtc,
    hourOfDayClientTz,
    postedAt: postedAt.toISOString(),
  };
}

function inferMediaType(urls: string[] | null): string | null {
  if (!urls || urls.length === 0) return null;
  if (urls.length > 1) return 'CAROUSEL';
  const url = urls[0].toLowerCase();
  if (/\.(mp4|mov|webm)/.test(url)) return 'VIDEO';
  if (/\.(jpg|jpeg|png|gif|webp)/.test(url)) return 'IMAGE';
  return 'OTHER';
}

function computeFleschKincaid(words: string[], sentences: string[]): number {
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const wordsPerSentence = words.length / sentences.length;
  const syllablesPerWord = syllables / words.length;
  return 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length === 0) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches?.length ?? 1;
}

function getHourInTimezone(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour');
    return parseInt(hourPart?.value ?? '0', 10);
  } catch {
    return date.getUTCHours();
  }
}
