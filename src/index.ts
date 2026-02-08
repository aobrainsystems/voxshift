export { runPipeline } from "./pipeline.js";
export { parseCliOptions, resolveRuntimeConfig } from "./config.js";
export { loadYouTubePolicy } from "./youtube/policy.js";
export { runYouTubeIntake } from "./youtube/intake.js";
export { uploadDubbedVideoToYouTube, buildYouTubeUploadMetadata } from "./youtube/upload.js";
export type { CliOptions, RuntimeConfig, Segment, PipelineResult } from "./types.js";
export type {
  YouTubePolicy,
  YouTubeIntakeResult,
  YouTubeUploadMetadata,
  YouTubeUploadResult,
  YouTubePrivacyStatus,
  IntakeDecision,
  IntakeReason,
} from "./youtube/types.js";
