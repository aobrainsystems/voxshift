export type IntakeDecision = "allow" | "soft_block" | "hard_block";
export type IntakeReasonSeverity = "info" | "soft" | "hard";
export type YouTubePrivacyStatus = "private" | "unlisted" | "public";

export interface IntakeReason {
  code: string;
  severity: IntakeReasonSeverity;
  message: string;
}

export interface YouTubePolicy {
  allowOnlySourceChannelIds: string[];
  allowRiskOverride: boolean;
  blockIfNotPublic: boolean;
  blockIfRegionRestricted: boolean;
  blockIfNotEmbeddable: boolean;
  blockMusicCategoryAsSoftRisk: boolean;
  requireDefaultAudioLanguage: boolean;
}

export interface YouTubeVideoSummary {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  categoryId?: string;
  privacyStatus?: string;
  uploadStatus?: string;
  license?: string;
  embeddable?: boolean;
  madeForKids?: boolean;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  regionRestrictionAllowed?: string[];
  regionRestrictionBlocked?: string[];
}

export interface YouTubeChannelSummary {
  id: string;
  title: string;
  customUrl?: string;
  country?: string;
}

export interface YouTubeIntakeResult {
  sourceUrl: string;
  videoId: string;
  fetchedAt: string;
  policyPath: string;
  decision: IntakeDecision;
  allowlistedChannel: boolean;
  reasons: IntakeReason[];
  video: YouTubeVideoSummary;
  channel?: YouTubeChannelSummary;
}

export interface RunYouTubeIntakeInput {
  sourceUrl: string;
  dataApiKey: string;
  policyPath: string;
  policy: YouTubePolicy;
  regionCode: string;
  artifactsDir: string;
}

export interface RunYouTubeIntakeOutput {
  artifactPath: string;
  result: YouTubeIntakeResult;
}

export interface YouTubeUploadMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: YouTubePrivacyStatus;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  madeForKids?: boolean;
  playlistId?: string;
}

export interface YouTubeUploadInput {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
  outputVideoPath: string;
  targetChannelId: string;
  dryRun: boolean;
  metadata: YouTubeUploadMetadata;
  fallbackTargetLanguage?: string;
  fallbackSourceTitle?: string;
  fallbackSourceChannelTitle?: string;
  fallbackSourceVideoId?: string;
  fallbackSourceVideoUrl?: string;
}

export interface YouTubeUploadResult {
  dryRun: boolean;
  privacyStatus: YouTubePrivacyStatus;
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  madeForKids?: boolean;
  playlistId?: string;
  authenticatedChannelId?: string;
  authenticatedChannelTitle?: string;
  uploadedVideoId?: string;
  uploadedVideoUrl?: string;
}
