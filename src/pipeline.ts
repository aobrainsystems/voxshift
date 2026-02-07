import fs from "node:fs/promises";
import path from "node:path";
import { createGeminiClient } from "./gemini/client.js";
import { transcribeAndTranslateAudio } from "./gemini/transcribeTranslate.js";
import { buildSpeakerVoiceMap, synthesizeSegments } from "./gemini/tts.js";
import {
  convertWavToMp3,
  ensureFfmpegAvailable,
  extractAudioToWav,
  muxDubbedAudioWithVideo,
  probeMedia,
} from "./media/ffmpeg.js";
import { composeDubbedTimeline } from "./audio/timeline.js";
import { writeSegmentsJson, writeSrt } from "./output/write.js";
import { logger } from "./logger.js";
import { defaultTranscribeModel, defaultTtsModel } from "./config.js";
import type { PipelineResult, RuntimeConfig } from "./types.js";

async function copyFileEnsured(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function finalizeAudioOutput(dubbedWavPath: string, outputPath: string, cwd: string): Promise<void> {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === ".mp3") {
    await convertWavToMp3(dubbedWavPath, outputPath, cwd);
    return;
  }

  await copyFileEnsured(dubbedWavPath, outputPath);
}

export async function runPipeline(config: RuntimeConfig): Promise<PipelineResult> {
  logger.info({ input: config.inputAbsolutePath }, "Starting Node.js dubbing pipeline");

  await fs.mkdir(config.artifactsDir, { recursive: true });
  try {
    await ensureFfmpegAvailable(config.workDir);

    const mediaInfo = await probeMedia(config.inputAbsolutePath, config.workDir);
    logger.info(
      {
        isVideo: mediaInfo.isVideo,
        durationSec: mediaInfo.durationSec,
        audioCodec: mediaInfo.audioCodec,
        videoCodec: mediaInfo.videoCodec,
      },
      "Input media probed",
    );

    const extractedAudioPath = path.join(config.artifactsDir, "audio", "source.wav");
    await extractAudioToWav(config.inputAbsolutePath, extractedAudioPath, config.workDir);

    const client = createGeminiClient(config.googleApiKey);
    const transcribeModel = config.transcribeModel ?? defaultTranscribeModel(config.modelTier);
    const ttsModel = config.ttsModel ?? defaultTtsModel(config.modelTier);

    logger.info({ transcribeModel, ttsModel }, "Using Gemini models");

    const segments = await transcribeAndTranslateAudio({
      client,
      audioPath: extractedAudioPath,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      model: transcribeModel,
    });

    logger.info({ segmentCount: segments.length }, "Transcription+translation complete");

    const speakerVoiceMap = buildSpeakerVoiceMap(segments, config.voiceA, config.voiceB);

    const synthesizedSegments = await synthesizeSegments({
      client,
      model: ttsModel,
      segments,
      voiceMap: speakerVoiceMap,
      outputDir: path.join(config.artifactsDir, "tts_segments"),
    });

    logger.info({ synthesizedCount: synthesizedSegments.length }, "TTS synthesis complete");

    const dubbedAudioPath = path.join(config.artifactsDir, "audio", "dubbed.wav");
    await composeDubbedTimeline({
      segments: synthesizedSegments,
      outputWavPath: dubbedAudioPath,
      mediaDurationSec: mediaInfo.durationSec,
    });

    const outputBaseWithoutExt = path.join(
      path.dirname(config.outputAbsolutePath),
      path.parse(config.outputAbsolutePath).name,
    );

    await writeSegmentsJson({
      outputPath: config.outputJsonAbsolutePath,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      inputPath: config.inputAbsolutePath,
      segments,
    });

    await writeSrt({
      outputPath: `${outputBaseWithoutExt}.${config.sourceLanguage}.srt`,
      segments,
      field: "sourceText",
    });

    await writeSrt({
      outputPath: `${outputBaseWithoutExt}.${config.targetLanguage}.srt`,
      segments,
      field: "translatedText",
    });

    if (mediaInfo.isVideo) {
      await muxDubbedAudioWithVideo(
        config.inputAbsolutePath,
        dubbedAudioPath,
        config.outputAbsolutePath,
        config.workDir,
      );
    } else {
      await finalizeAudioOutput(dubbedAudioPath, config.outputAbsolutePath, config.workDir);
    }

    logger.info({ outputPath: config.outputAbsolutePath }, "Pipeline complete");

    return {
      mediaInfo,
      segments,
      extractedAudioPath,
      dubbedAudioPath,
      outputPath: config.outputAbsolutePath,
      outputJsonPath: config.outputJsonAbsolutePath,
    };
  } finally {
    if (!config.keepArtifacts) {
      await fs.rm(config.artifactsDir, { recursive: true, force: true });
    }
  }
}
