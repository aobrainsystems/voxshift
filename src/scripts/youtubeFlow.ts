import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Command } from "commander";
import { z } from "zod";
import { parseCliOptions, resolveRuntimeConfig } from "../config.js";
import { runPipeline } from "../pipeline.js";
import { loadYouTubePolicy } from "../youtube/policy.js";
import { runYouTubeIntake } from "../youtube/intake.js";
import type { IntakeDecision, YouTubeUploadMetadata, YouTubeUploadResult } from "../youtube/types.js";
import { uploadDubbedVideoToYouTube } from "../youtube/upload.js";

type RunMode = "pipeline" | "upload-only";

type IntakeStatus = IntakeDecision | "skipped";

interface ExistingRunManifest {
  mode?: RunMode;
  sourceVideoId?: string | null;
  targetLanguage?: string | null;
  targetChannelId?: string | null;
  uploadFileSha256?: string | null;
  upload?: {
    uploadedVideoId?: string;
    uploadedVideoUrl?: string;
    dryRun?: boolean;
    skippedDuplicate?: boolean;
  };
}

const metadataFileSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    categoryId: z.string().min(1).optional(),
    privacyStatus: z.enum(["private", "unlisted", "public"]).optional(),
    defaultLanguage: z.string().min(1).optional(),
    defaultAudioLanguage: z.string().min(1).optional(),
    madeForKids: z.boolean().optional(),
    playlistId: z.string().min(1).optional(),
  })
  .strict();

function ensureString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseRunMode(value: string | undefined): RunMode {
  if (value === "pipeline" || value === "upload-only") {
    return value;
  }
  throw new Error(`Invalid --mode '${value}'. Allowed values: pipeline, upload-only.`);
}

function parseOptionalBoolean(value: string | undefined, optionName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid ${optionName} value '${value}'. Use true or false.`);
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const tags = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return tags.length > 0 ? tags : undefined;
}

function sanitizeToken(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function summarizeReasons(reasons: { severity: string; code: string; message: string }[]): string {
  return reasons.map((reason) => `[${reason.severity}] ${reason.code}: ${reason.message}`).join("; ");
}

function normalizeProfile(profile: string | undefined): string | undefined {
  const trimmed = profile?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

function resolveCredential(baseName: string, profile: string | undefined): string | undefined {
  const normalizedProfile = normalizeProfile(profile);

  if (normalizedProfile) {
    const profileScoped = process.env[`${baseName}_${normalizedProfile}`];
    if (profileScoped) {
      return profileScoped;
    }
  }

  return process.env[baseName];
}

function mergeUploadMetadata(
  fileMetadata: YouTubeUploadMetadata,
  cliMetadata: YouTubeUploadMetadata,
): YouTubeUploadMetadata {
  return {
    ...fileMetadata,
    ...cliMetadata,
  };
}

function buildCliUploadMetadata(raw: {
  title?: string;
  description?: string;
  tags?: string;
  categoryId?: string;
  privacyStatus?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  madeForKids?: string;
  playlistId?: string;
}): YouTubeUploadMetadata {
  const madeForKids = parseOptionalBoolean(raw.madeForKids, "--made-for-kids");

  return {
    ...(ensureString(raw.title) ? { title: ensureString(raw.title) } : {}),
    ...(ensureString(raw.description) ? { description: ensureString(raw.description) } : {}),
    ...(parseCsv(raw.tags) ? { tags: parseCsv(raw.tags) } : {}),
    ...(ensureString(raw.categoryId) ? { categoryId: ensureString(raw.categoryId) } : {}),
    ...(raw.privacyStatus === "private" || raw.privacyStatus === "unlisted" || raw.privacyStatus === "public"
      ? { privacyStatus: raw.privacyStatus }
      : {}),
    ...(ensureString(raw.defaultLanguage) ? { defaultLanguage: ensureString(raw.defaultLanguage) } : {}),
    ...(ensureString(raw.defaultAudioLanguage)
      ? { defaultAudioLanguage: ensureString(raw.defaultAudioLanguage) }
      : {}),
    ...(typeof madeForKids === "boolean" ? { madeForKids } : {}),
    ...(ensureString(raw.playlistId) ? { playlistId: ensureString(raw.playlistId) } : {}),
  };
}

async function loadMetadataFile(metadataFilePath: string | undefined, cwd: string): Promise<YouTubeUploadMetadata> {
  if (!metadataFilePath) {
    return {};
  }

  const resolvedPath = path.resolve(cwd, metadataFilePath);
  const content = await fs.readFile(resolvedPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse metadata file '${resolvedPath}': ${message}`);
  }

  return metadataFileSchema.parse(parsed);
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk: Buffer | string) => {
      hash.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readExistingRunManifests(runArtifactsDir: string): Promise<ExistingRunManifest[]> {
  try {
    const entries = await fs.readdir(runArtifactsDir, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));

    const manifests = await Promise.all(
      jsonFiles.map(async (entry) => {
        try {
          const content = await fs.readFile(path.join(runArtifactsDir, entry.name), "utf8");
          return JSON.parse(content) as ExistingRunManifest;
        } catch {
          return {} as ExistingRunManifest;
        }
      }),
    );

    return manifests;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("youtube-flow")
    .description("Run pipeline and/or upload flow with optional YouTube intake checks")
    .option("--mode <mode>", "Execution mode: pipeline or upload-only", "pipeline")
    .option("--source-url <url>", "Optional source YouTube URL used for intake checks")
    .option("--input <path>", "Local media file used as pipeline input (pipeline mode)")
    .option("--upload-file <path>", "Existing local video file to upload (upload-only mode)")
    .option("--source-language <code>", "Source language code (pipeline mode)")
    .option("--target-language <code>", "Target language code")
    .option("--output <path>", "Output media path (pipeline mode)")
    .option("--output-json <path>", "Output JSON sidecar path (pipeline mode)")
    .option("--model-tier <tier>", "Gemini model tier: flash or pro (pipeline mode)", "flash")
    .option("--voice-a <voice>", "Primary voice (pipeline mode)", "Kore")
    .option("--voice-b <voice>", "Secondary voice (pipeline mode)")
    .option("--transcribe-model <model>", "Override transcription model (pipeline mode)")
    .option("--tts-model <model>", "Override TTS model (pipeline mode)")
    .option("--keep-artifacts", "Do not delete temporary artifacts (pipeline mode)", false)
    .option("--policy-config <path>", "Policy JSON path", "config/youtubePolicy.json")
    .option("--intake-artifacts-dir <path>", "Intake artifact directory", "artifacts/intake")
    .option("--run-artifacts-dir <path>", "Run manifest directory", "artifacts/youtube-runs")
    .option("--region-code <code>", "Region code used for restriction checks", "US")
    .option("--approve-risk", "Approve soft-risk intake results", false)
    .option("--approval-reason <text>", "Required when approving intake risk or omitting source-url in pipeline mode")
    .option("--metadata-file <path>", "JSON file with upload metadata")
    .option("--title <text>", "Upload title override")
    .option("--description <text>", "Upload description override")
    .option("--tags <csv>", "Comma-separated upload tags")
    .option("--category-id <id>", "YouTube category ID (for example 22 for People & Blogs)")
    .option("--privacy-status <status>", "Upload privacy status: private|unlisted|public")
    .option("--default-language <code>", "Upload default language")
    .option("--default-audio-language <code>", "Upload default audio language")
    .option("--made-for-kids <true|false>", "Set upload made-for-kids flag")
    .option("--playlist-id <id>", "Playlist ID to insert uploaded video into")
    .option("--source-title <text>", "Fallback source title when source-url is omitted")
    .option("--source-channel-title <text>", "Fallback source channel title when source-url is omitted")
    .option("--channel-profile <name>", "Credential profile suffix for upload env vars")
    .option("--target-channel-id <id>", "Required channel ID. Upload fails if OAuth channel does not match")
    .option("--dry-run-upload", "Prepare upload payload and validate channel, but skip video upload", false)
    .option("--skip-upload", "Skip upload step", false)
    .option("--force-upload", "Bypass duplicate-upload protection", false);

  program.parse(process.argv);

  const raw = program.opts<{
    mode: string;
    sourceUrl?: string;
    input?: string;
    uploadFile?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    output?: string;
    outputJson?: string;
    modelTier: "flash" | "pro";
    voiceA: string;
    voiceB?: string;
    transcribeModel?: string;
    ttsModel?: string;
    keepArtifacts: boolean;
    policyConfig: string;
    intakeArtifactsDir: string;
    runArtifactsDir: string;
    regionCode: string;
    approveRisk: boolean;
    approvalReason?: string;
    metadataFile?: string;
    title?: string;
    description?: string;
    tags?: string;
    categoryId?: string;
    privacyStatus?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    madeForKids?: string;
    playlistId?: string;
    sourceTitle?: string;
    sourceChannelTitle?: string;
    channelProfile?: string;
    targetChannelId?: string;
    dryRunUpload: boolean;
    skipUpload: boolean;
    forceUpload: boolean;
  }>();

  const cwd = process.cwd();
  const mode = parseRunMode(raw.mode);

  if (mode === "upload-only" && raw.skipUpload) {
    throw new Error("--skip-upload cannot be used with --mode upload-only.");
  }

  let intakeStatus: IntakeStatus = "skipped";
  let intakeArtifactPath: string | null = null;
  let intakeReasons: { severity: string; code: string; message: string }[] = [];
  let policyPath: string | null = null;

  let sourceVideoId: string | null = null;
  let sourceChannelId: string | null = null;
  let sourceChannelTitle: string | null = null;
  let sourceVideoUrl: string | null = null;
  let sourceTitle: string | null = ensureString(raw.sourceTitle) ?? null;

  if (raw.sourceUrl) {
    const dataApiKey = process.env.YOUTUBE_DATA_API_KEY;
    if (!dataApiKey) {
      throw new Error("YOUTUBE_DATA_API_KEY is required when --source-url is provided.");
    }

    const policyLoaded = await loadYouTubePolicy(raw.policyConfig, cwd);
    policyPath = policyLoaded.path;

    const intake = await runYouTubeIntake({
      sourceUrl: raw.sourceUrl,
      dataApiKey,
      policyPath: policyLoaded.path,
      policy: policyLoaded.policy,
      regionCode: raw.regionCode,
      artifactsDir: path.resolve(cwd, raw.intakeArtifactsDir),
    });

    intakeStatus = intake.result.decision;
    intakeArtifactPath = intake.artifactPath;
    intakeReasons = intake.result.reasons;
    sourceVideoId = intake.result.videoId;
    sourceChannelId = intake.result.video.channelId;
    sourceChannelTitle = intake.result.video.channelTitle;
    sourceVideoUrl = intake.result.sourceUrl;
    sourceTitle = intake.result.video.title;

    console.log(`Intake decision: ${intakeStatus}`);
    console.log(`Intake artifact: ${intakeArtifactPath}`);

    if (intakeStatus === "hard_block") {
      throw new Error(`Intake hard-blocked this source. ${summarizeReasons(intakeReasons)}`);
    }

    if (intakeStatus === "soft_block") {
      if (!policyLoaded.policy.allowRiskOverride) {
        throw new Error(`Policy disallows risk overrides. ${summarizeReasons(intakeReasons)}`);
      }

      if (!raw.approveRisk) {
        throw new Error(
          `Intake soft-blocked this source. Re-run with --approve-risk --approval-reason \"...\". ${summarizeReasons(intakeReasons)}`,
        );
      }

      if (!ensureString(raw.approvalReason)) {
        throw new Error("--approval-reason is required when --approve-risk is set.");
      }
    }
  } else {
    intakeReasons = [
      {
        severity: "info",
        code: "source_url_omitted",
        message: "Intake skipped because --source-url was not provided.",
      },
    ];

    if (mode === "pipeline" && !ensureString(raw.approvalReason)) {
      throw new Error(
        "When running pipeline mode without --source-url, provide --approval-reason to record rights confirmation.",
      );
    }

    if (mode === "upload-only") {
      console.log("Intake skipped in upload-only mode (no --source-url).");
    } else {
      console.log("Intake skipped: --source-url was not provided.");
    }
  }

  let pipelineResult:
    | {
        outputPath: string;
        outputJsonPath: string;
        sourceSrtPath: string;
        translatedSrtPath: string;
        inputAbsolutePath: string;
        mediaIsVideo: boolean;
      }
    | null = null;

  let uploadFilePath: string;
  let inputSha256: string | null = null;

  if (mode === "pipeline") {
    if (!raw.input || !raw.sourceLanguage || !raw.targetLanguage) {
      throw new Error("Pipeline mode requires --input, --source-language, and --target-language.");
    }

    const cliOptions = parseCliOptions({
      input: raw.input,
      sourceLanguage: raw.sourceLanguage,
      targetLanguage: raw.targetLanguage,
      output: raw.output,
      outputJson: raw.outputJson,
      modelTier: raw.modelTier,
      voiceA: raw.voiceA,
      voiceB: raw.voiceB,
      transcribeModel: raw.transcribeModel,
      ttsModel: raw.ttsModel,
      keepArtifacts: Boolean(raw.keepArtifacts),
    });

    const runtimeConfig = resolveRuntimeConfig(cliOptions, cwd);
    const result = await runPipeline(runtimeConfig);

    if (!raw.skipUpload && !result.mediaInfo.isVideo) {
      throw new Error("Upload step requires a video output. Current pipeline run produced audio output.");
    }

    const outputBase = path.join(path.dirname(result.outputPath), path.parse(result.outputPath).name);
    pipelineResult = {
      outputPath: result.outputPath,
      outputJsonPath: result.outputJsonPath,
      sourceSrtPath: `${outputBase}.${runtimeConfig.sourceLanguage}.srt`,
      translatedSrtPath: `${outputBase}.${runtimeConfig.targetLanguage}.srt`,
      inputAbsolutePath: runtimeConfig.inputAbsolutePath,
      mediaIsVideo: result.mediaInfo.isVideo,
    };

    uploadFilePath = result.outputPath;
    inputSha256 = await sha256File(runtimeConfig.inputAbsolutePath);
  } else {
    if (!raw.uploadFile) {
      throw new Error("Upload-only mode requires --upload-file.");
    }

    uploadFilePath = path.resolve(cwd, raw.uploadFile);
    await fs.access(uploadFilePath);
  }

  const fileMetadata = await loadMetadataFile(raw.metadataFile, cwd);
  const cliMetadata = buildCliUploadMetadata(raw);
  const uploadMetadata = mergeUploadMetadata(fileMetadata, cliMetadata);

  const resolvedTargetLanguage =
    ensureString(raw.targetLanguage) ?? uploadMetadata.defaultLanguage ?? uploadMetadata.defaultAudioLanguage ?? "en";

  const runArtifactsDir = path.resolve(cwd, raw.runArtifactsDir);
  await fs.mkdir(runArtifactsDir, { recursive: true });

  const uploadFileSha256 = await sha256File(uploadFilePath);

  let upload:
    | YouTubeUploadResult
    | {
        skippedDuplicate: true;
        uploadedVideoId?: string;
        uploadedVideoUrl?: string;
      }
    | null = null;

  const targetChannelId = ensureString(raw.targetChannelId) ?? null;

  if (!raw.skipUpload) {
    if (!targetChannelId) {
      throw new Error("Upload requires --target-channel-id to enforce channel-specific publishing.");
    }

    const existingManifests = await readExistingRunManifests(runArtifactsDir);

    const duplicate = existingManifests.find((manifest) => {
      if (!manifest.upload || manifest.upload.dryRun || manifest.upload.skippedDuplicate) {
        return false;
      }

      if (!manifest.upload.uploadedVideoId) {
        return false;
      }

      if (manifest.targetChannelId !== targetChannelId) {
        return false;
      }

      if (sourceVideoId) {
        return manifest.sourceVideoId === sourceVideoId && manifest.targetLanguage === resolvedTargetLanguage;
      }

      return manifest.uploadFileSha256 === uploadFileSha256;
    });

    if (duplicate && !raw.forceUpload) {
      upload = {
        skippedDuplicate: true,
        uploadedVideoId: duplicate.upload?.uploadedVideoId,
        uploadedVideoUrl: duplicate.upload?.uploadedVideoUrl,
      };
      console.log("Upload skipped because a matching upload already exists for this channel.");
      console.log("Use --force-upload to bypass this protection.");
    } else {
      const oauthClientId = resolveCredential("YOUTUBE_OAUTH_CLIENT_ID", raw.channelProfile);
      const oauthClientSecret = resolveCredential("YOUTUBE_OAUTH_CLIENT_SECRET", raw.channelProfile);
      const oauthRefreshToken = resolveCredential("YOUTUBE_OAUTH_REFRESH_TOKEN", raw.channelProfile);

      if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) {
        const profileNote = ensureString(raw.channelProfile)
          ? ` using profile '${raw.channelProfile}' (or fallback defaults)`
          : "";

        throw new Error(
          "Upload requires YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, and " +
            `YOUTUBE_OAUTH_REFRESH_TOKEN${profileNote}.`,
        );
      }

      upload = await uploadDubbedVideoToYouTube({
        oauthClientId,
        oauthClientSecret,
        oauthRefreshToken,
        outputVideoPath: uploadFilePath,
        targetChannelId,
        dryRun: raw.dryRunUpload,
        metadata: uploadMetadata,
        fallbackTargetLanguage: resolvedTargetLanguage,
        fallbackSourceTitle: sourceTitle ?? ensureString(raw.sourceTitle) ?? path.parse(uploadFilePath).name,
        fallbackSourceChannelTitle: sourceChannelTitle ?? ensureString(raw.sourceChannelTitle),
        fallbackSourceVideoId: sourceVideoId ?? undefined,
        fallbackSourceVideoUrl: sourceVideoUrl ?? ensureString(raw.sourceUrl),
      });
    }
  }

  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replaceAll(":", "-");
  const manifestToken = sanitizeToken(sourceVideoId ?? path.parse(uploadFilePath).name);

  const runManifest = {
    createdAt: timestamp,
    mode,
    sourceUrl: sourceVideoUrl ?? ensureString(raw.sourceUrl) ?? null,
    sourceVideoId,
    sourceTitle,
    sourceChannelId,
    sourceChannelTitle,
    targetLanguage: resolvedTargetLanguage,
    targetChannelId,
    policyPath,
    intakeArtifactPath,
    intakeDecision: intakeStatus,
    intakeReasons,
    riskApproved: raw.approveRisk,
    approvalReason: ensureString(raw.approvalReason) ?? null,
    uploadMetadata,
    uploadFilePath,
    uploadFileSha256,
    inputSha256,
    pipeline: pipelineResult,
    upload,
  };

  const runManifestPath = path.join(runArtifactsDir, `${manifestToken}_${resolvedTargetLanguage}_${safeTimestamp}.json`);
  await fs.writeFile(runManifestPath, JSON.stringify(runManifest, null, 2), "utf8");

  console.log("YouTube flow completed.");
  console.log(`Mode: ${mode}`);

  if (pipelineResult) {
    console.log(`Pipeline output: ${pipelineResult.outputPath}`);
  } else {
    console.log(`Upload input file: ${uploadFilePath}`);
  }

  console.log(`Run manifest: ${runManifestPath}`);

  if (upload && "uploadedVideoUrl" in upload && upload.uploadedVideoUrl) {
    console.log(`Uploaded video: ${upload.uploadedVideoUrl}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`YouTube flow failed: ${message}`);
  process.exitCode = 1;
});
