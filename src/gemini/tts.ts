import fs from "node:fs/promises";
import path from "node:path";
import type { GoogleGenAI } from "@google/genai";
import type { Segment } from "../types.js";
import { readWavPcm16Mono, writeWavFromPcm16 } from "../audio/wav.js";

export interface SynthesizedSegment {
  index: number;
  speaker: string;
  startSec: number;
  endSec: number;
  translatedText: string;
  wavPath: string;
  sampleRate: number;
  durationSec: number;
}

interface InlineAudioPart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

function parseSampleRate(mimeType?: string): number {
  if (!mimeType) {
    return 24000;
  }

  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return 24000;
  }

  return Number(match[1]);
}

function extractInlineAudioData(response: unknown): { data: string; mimeType?: string } {
  const candidates = (response as { candidates?: Array<{ content?: { parts?: InlineAudioPart[] } }> }).candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("No candidates returned from Gemini TTS.");
  }

  const parts = candidates[0].content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { data: part.inlineData.data, mimeType: part.inlineData.mimeType };
    }
  }

  throw new Error("Gemini TTS response did not include audio inline data.");
}

async function withRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      const waitMs = 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }

  throw lastError;
}

export function buildSpeakerVoiceMap(segments: Segment[], voiceA: string, voiceB?: string): Record<string, string> {
  const map: Record<string, string> = {};
  const orderedSpeakers = [...new Set(segments.map((segment) => segment.speaker))];

  if (orderedSpeakers.length === 0) {
    return map;
  }

  map[orderedSpeakers[0]] = voiceA;

  if (orderedSpeakers.length > 1) {
    map[orderedSpeakers[1]] = voiceB ?? voiceA;
  }

  for (let index = 2; index < orderedSpeakers.length; index += 1) {
    map[orderedSpeakers[index]] = voiceA;
  }

  return map;
}

export async function synthesizeSegments(params: {
  client: GoogleGenAI;
  model: string;
  segments: Segment[];
  voiceMap: Record<string, string>;
  outputDir: string;
}): Promise<SynthesizedSegment[]> {
  await fs.mkdir(params.outputDir, { recursive: true });

  const synthesized: SynthesizedSegment[] = [];

  for (let index = 0; index < params.segments.length; index += 1) {
    const segment = params.segments[index];
    const voiceName = params.voiceMap[segment.speaker] ?? Object.values(params.voiceMap)[0];

    const response = await withRetry(async () => {
      return params.client.models.generateContent({
        model: params.model,
        contents: [{ text: segment.translatedText }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });
    });

    const audioPart = extractInlineAudioData(response);
    const audioBuffer = Buffer.from(audioPart.data, "base64");
    const mimeType = audioPart.mimeType?.toLowerCase() ?? "audio/pcm";
    const wavPath = path.join(params.outputDir, `${String(index).padStart(5, "0")}.wav`);

    let sampleRate = parseSampleRate(audioPart.mimeType);

    if (mimeType.includes("audio/wav")) {
      await fs.writeFile(wavPath, audioBuffer);
    } else {
      await writeWavFromPcm16({
        outputPath: wavPath,
        pcmData: audioBuffer,
        sampleRate,
      });
    }

    const wavInfo = await readWavPcm16Mono(wavPath);
    sampleRate = wavInfo.sampleRate;
    const durationSec = wavInfo.samples.length / sampleRate;

    synthesized.push({
      index,
      speaker: segment.speaker,
      startSec: segment.startSec,
      endSec: segment.endSec,
      translatedText: segment.translatedText,
      wavPath,
      sampleRate,
      durationSec,
    });
  }

  return synthesized;
}
