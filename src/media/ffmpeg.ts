import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../util/shell.js";
import type { MediaInfo } from "../types.js";

interface FfprobeJson {
  format?: {
    duration?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
  }>;
}

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);

export async function ensureFfmpegAvailable(cwd: string): Promise<void> {
  try {
    await runCommand("which", ["ffmpeg"], cwd);
    await runCommand("which", ["ffprobe"], cwd);
  } catch {
    throw new Error(
      "ffmpeg/ffprobe are required but were not found in PATH. Install ffmpeg first, then retry.",
    );
  }
}

export async function probeMedia(inputPath: string, cwd: string): Promise<MediaInfo> {
  const { stdout } = await runCommand(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath],
    cwd,
  );

  const parsed = JSON.parse(stdout) as FfprobeJson;
  const durationSec = Number(parsed.format?.duration ?? 0);
  const streams = parsed.streams ?? [];
  const hasVideoStream = streams.some((stream) => stream.codec_type === "video");
  const extensionIsVideo = videoExtensions.has(path.extname(inputPath).toLowerCase());
  const isVideo = hasVideoStream || extensionIsVideo;

  const audioCodec = streams.find((stream) => stream.codec_type === "audio")?.codec_name;
  const videoCodec = streams.find((stream) => stream.codec_type === "video")?.codec_name;

  return {
    path: inputPath,
    durationSec,
    isVideo,
    audioCodec,
    videoCodec,
  };
}

export async function extractAudioToWav(inputPath: string, outputPath: string, cwd: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    cwd,
  );
}

export async function muxDubbedAudioWithVideo(
  inputVideoPath: string,
  dubbedAudioPath: string,
  outputVideoPath: string,
  cwd: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputVideoPath,
      "-i",
      dubbedAudioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outputVideoPath,
    ],
    cwd,
  );
}

export async function convertWavToMp3(wavPath: string, outputPath: string, cwd: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-i",
      wavPath,
      "-codec:a",
      "libmp3lame",
      "-qscale:a",
      "2",
      outputPath,
    ],
    cwd,
  );
}
