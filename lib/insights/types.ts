export type InsMemoryType = 'dismissal' | 'edit_pattern' | 'winning_pattern' | 'industry_signal';
export type InsRecommendationConfidenceBand = 'strong' | 'moderate' | 'below_floor';
export type InsAdminAuditAction = 'view' | 'dismiss' | 'annotate' | 'export' | 'override' | 'unsuppress';
export type InsSource = 'composer' | 'cap';

export interface InsPostFeatures {
  id: string;
  companyId: string;
  profileId: string;
  source: InsSource;
  bundlePostId: string;
  capCampaignPostId: string | null;
  platform: string;
  wordCount: number;
  sentenceCount: number;
  hasQuestion: boolean;
  emojiCount: number;
  hashtagCount: number;
  hasLink: boolean;
  hasMedia: boolean;
  mediaType: string | null;
  readingGrade: number | null;
  dayOfWeek: number;
  hourOfDayUtc: number;
  hourOfDayClientTz: number;
  sentimentScore: number | null;
  topicTags: string[] | null;
  postedAt: string;
  extractedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsClientMemory {
  id: string;
  companyId: string;
  memoryType: InsMemoryType;
  payload: Record<string, unknown>;
  strikes: number;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsRecommendation {
  id: string;
  companyId: string;
  platform: string;
  recommendationType: string;
  headline: string;
  body: string;
  successMetric: string;
  confidenceScore: number;
  confidenceBand: InsRecommendationConfidenceBand;
  evidenceRefs: string[];
  suppressed: boolean;
  generatedAt: string;
  expiresAt: string;
}

export interface InsRecommendationEvidence {
  id: string;
  recommendationId: string;
  sourceTable: 'social_post_analytics_snapshots' | 'ins_post_features';
  sourceRowRef: string;
  summary: string;
  createdAt: string;
}

export interface InsConsent {
  companyId: string;
  crossClientLearningConsent: boolean;
  competitorTrackingConsent: boolean;
  consentedAt: string | null;
  consentedByUserId: string | null;
  msaVersion: string | null;
}

export interface InsIngestLog {
  id: string;
  cronRoute: string;
  companyId: string | null;
  ranAt: string;
  postsProcessed: number;
  metricsRecorded: number;
  featuresExtracted: number;
  errors: unknown[];
  durationMs: number;
}

export interface InsAdminAudit {
  id: string;
  operatorUserId: string;
  clientCompanyId: string;
  action: InsAdminAuditAction;
  actionDetails: Record<string, unknown>;
  clientIp: string | null;
  userAgent: string | null;
  occurredAt: string;
}
