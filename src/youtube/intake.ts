import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  IntakeDecision,
  IntakeReason,
  RunYouTubeIntakeInput,
  RunYouTubeIntakeOutput,
  YouTubeChannelSummary,
  YouTubeIntakeResult,
  YouTubeVideoSummary,
} from "./types.js";

const videosResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z
          .object({
            title: z.string().optional(),
            channelId: z.string().optional(),
            channelTitle: z.string().optional(),
            categoryId: z.string().optional(),
            defaultAudioLanguage: z.string().optional(),
            defaultLanguage: z.string().optional(),
            liveBroadcastContent: z.string().optional(),
          })
          .optional(),
        status: z
          .object({
            privacyStatus: z.string().optional(),
            uploadStatus: z.string().optional(),
            license: z.string().optional(),
            embeddable: z.boolean().optional(),
            madeForKids: z.boolean().optional(),
          })
          .optional(),
        contentDetails: z
          .object({
            regionRestriction: z
              .object({
                allowed: z.array(z.string()).optional(),
                blocked: z.array(z.string()).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const channelsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z
          .object({
            title: z.string().optional(),
            customUrl: z.string().optional(),
            country: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

function parseYouTubeVideoId(input: string): { normalizedUrl: string; videoId: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    url = new URL(`https://${input}`);
  }

  const host = url.hostname.toLowerCase();
  let videoId = "";

  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (host.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0] ?? "")) {
        videoId = parts[1] ?? "";
      }
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Invalid YouTube URL or unsupported format.");
  }

  return {
    videoId,
    normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function fetchGoogleApiJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube API request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

function summarizeVideo(videoRaw: z.infer<typeof videosResponseSchema>["items"][number]): YouTubeVideoSummary {
  return {
    id: videoRaw.id,
    title: videoRaw.snippet?.title ?? "",
    channelId: videoRaw.snippet?.channelId ?? "",
    channelTitle: videoRaw.snippet?.channelTitle ?? "",
    categoryId: videoRaw.snippet?.categoryId,
    privacyStatus: videoRaw.status?.privacyStatus,
    uploadStatus: videoRaw.status?.uploadStatus,
    license: videoRaw.status?.license,
    embeddable: videoRaw.status?.embeddable,
    madeForKids: videoRaw.status?.madeForKids,
    defaultLanguage: videoRaw.snippet?.defaultLanguage,
    defaultAudioLanguage: videoRaw.snippet?.defaultAudioLanguage,
    regionRestrictionAllowed: videoRaw.contentDetails?.regionRestriction?.allowed,
    regionRestrictionBlocked: videoRaw.contentDetails?.regionRestriction?.blocked,
  };
}

function summarizeChannel(
  channelRaw: z.infer<typeof channelsResponseSchema>["items"][number] | undefined,
): YouTubeChannelSummary | undefined {
  if (!channelRaw) {
    return undefined;
  }

  return {
    id: channelRaw.id,
    title: channelRaw.snippet?.title ?? "",
    customUrl: channelRaw.snippet?.customUrl,
    country: channelRaw.snippet?.country,
  };
}

function evaluateDecision(
  video: YouTubeVideoSummary,
  regionCode: string,
  allowlistedChannel: boolean,
  policy: RunYouTubeIntakeInput["policy"],
): { decision: IntakeDecision; reasons: IntakeReason[] } {
  const reasons: IntakeReason[] = [];

  if (!allowlistedChannel) {
    reasons.push({
      code: "channel_not_allowlisted",
      severity: "hard",
      message: "Source channel is not in allowOnlySourceChannelIds.",
    });
  }

  if (policy.blockIfNotPublic && video.privacyStatus !== "public") {
    reasons.push({
      code: "video_not_public",
      severity: "hard",
      message: `Video privacy status is '${video.privacyStatus ?? "unknown"}', expected 'public'.`,
    });
  }

  if (video.uploadStatus && video.uploadStatus !== "processed") {
    reasons.push({
      code: "video_not_processed",
      severity: "hard",
      message: `Video uploadStatus is '${video.uploadStatus}', expected 'processed'.`,
    });
  }

  if (policy.blockIfNotEmbeddable && video.embeddable === false) {
    reasons.push({
      code: "video_not_embeddable",
      severity: "hard",
      message: "Video is not embeddable according to API metadata.",
    });
  }

  if (policy.blockIfRegionRestricted) {
    const blocked = video.regionRestrictionBlocked ?? [];
    const allowed = video.regionRestrictionAllowed ?? [];

    if (blocked.includes(regionCode)) {
      reasons.push({
        code: "region_blocked",
        severity: "hard",
        message: `Video is blocked in region '${regionCode}'.`,
      });
    }

    if (allowed.length > 0 && !allowed.includes(regionCode)) {
      reasons.push({
        code: "region_not_allowed",
        severity: "hard",
        message: `Video is not explicitly allowed in region '${regionCode}'.`,
      });
    }
  }

  if ((video.license ?? "").toLowerCase() !== "creativecommon") {
    reasons.push({
      code: "non_cc_license",
      severity: "soft",
      message: "Video license is not Creative Commons; verify republishing rights.",
    });
  }

  if (policy.requireDefaultAudioLanguage && !video.defaultAudioLanguage) {
    reasons.push({
      code: "missing_default_audio_language",
      severity: "soft",
      message: "defaultAudioLanguage is missing, language metadata may be unreliable.",
    });
  }

  if (policy.blockMusicCategoryAsSoftRisk && video.categoryId === "10") {
    reasons.push({
      code: "music_category",
      severity: "soft",
      message: "Video category is Music, which typically has higher rights complexity.",
    });
  }

  if (video.madeForKids === true) {
    reasons.push({
      code: "made_for_kids",
      severity: "soft",
      message: "Video is marked madeForKids; additional compliance review is recommended.",
    });
  }

  const hasHard = reasons.some((reason) => reason.severity === "hard");
  if (hasHard) {
    return { decision: "hard_block", reasons };
  }

  const hasSoft = reasons.some((reason) => reason.severity === "soft");
  if (hasSoft) {
    return { decision: "soft_block", reasons };
  }

  return {
    decision: "allow",
    reasons: [
      {
        code: "allow",
        severity: "info",
        message: "No hard or soft risk signals detected by current policy checks.",
      },
    ],
  };
}

export async function runYouTubeIntake(input: RunYouTubeIntakeInput): Promise<RunYouTubeIntakeOutput> {
  const { normalizedUrl, videoId } = parseYouTubeVideoId(input.sourceUrl);

  const videosUrl =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=snippet,status,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(input.dataApiKey)}`;

  const videosResponseRaw = await fetchGoogleApiJson<unknown>(videosUrl);
  const videosResponse = videosResponseSchema.parse(videosResponseRaw);
  const videoRaw = videosResponse.items[0];

  if (!videoRaw) {
    const missingResult: YouTubeIntakeResult = {
      sourceUrl: normalizedUrl,
      videoId,
      fetchedAt: new Date().toISOString(),
      policyPath: input.policyPath,
      decision: "hard_block",
      allowlistedChannel: false,
      reasons: [
        {
          code: "video_not_found",
          severity: "hard",
          message: "YouTube video was not found or is inaccessible for this API key.",
        },
      ],
      video: {
        id: videoId,
        title: "",
        channelId: "",
        channelTitle: "",
      },
    };

    await fs.mkdir(input.artifactsDir, { recursive: true });
    const artifactPath = path.join(input.artifactsDir, `${videoId}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(missingResult, null, 2), "utf8");
    return { artifactPath, result: missingResult };
  }

  const video = summarizeVideo(videoRaw);

  const channelsUrl =
    "https://www.googleapis.com/youtube/v3/channels" +
    `?part=snippet&id=${encodeURIComponent(video.channelId)}&key=${encodeURIComponent(input.dataApiKey)}`;

  const channelsResponseRaw = await fetchGoogleApiJson<unknown>(channelsUrl);
  const channelsResponse = channelsResponseSchema.parse(channelsResponseRaw);
  const channel = summarizeChannel(channelsResponse.items[0]);

  const allowlistedChannel = input.policy.allowOnlySourceChannelIds.includes(video.channelId);
  const { decision, reasons } = evaluateDecision(video, input.regionCode, allowlistedChannel, input.policy);

  const result: YouTubeIntakeResult = {
    sourceUrl: normalizedUrl,
    videoId,
    fetchedAt: new Date().toISOString(),
    policyPath: input.policyPath,
    decision,
    allowlistedChannel,
    reasons,
    video,
    channel,
  };

  await fs.mkdir(input.artifactsDir, { recursive: true });
  const artifactPath = path.join(input.artifactsDir, `${videoId}.json`);
  await fs.writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");

  return {
    artifactPath,
    result,
  };
}
