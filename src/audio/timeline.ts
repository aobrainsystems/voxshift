import fs from "node:fs/promises";
import path from "node:path";
import { readWavPcm16Mono, writeWavPcm16Mono } from "./wav.js";
import type { SynthesizedSegment } from "../gemini/tts.js";

function resampleLinear(samples: Int16Array, sourceRate: number, targetRate: number): Int16Array {
  if (sourceRate === targetRate) {
    return samples;
  }

  const ratio = targetRate / sourceRate;
  const targetLength = Math.max(1, Math.round(samples.length * ratio));
  const output = new Int16Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index / ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, samples.length - 1);
    const alpha = sourcePosition - left;
    output[index] = Math.round(samples[left] * (1 - alpha) + samples[right] * alpha);
  }

  return output;
}

export async function composeDubbedTimeline(params: {
  segments: SynthesizedSegment[];
  outputWavPath: string;
  targetSampleRate?: number;
  mediaDurationSec?: number;
}): Promise<void> {
  if (params.segments.length === 0) {
    throw new Error("No synthesized segments were provided.");
  }

  await fs.mkdir(path.dirname(params.outputWavPath), { recursive: true });

  const sampleRate = params.targetSampleRate ?? 24000;
  const inferredDuration = Math.max(
    ...params.segments.map((segment) => segment.endSec),
    ...params.segments.map((segment) => segment.startSec + segment.durationSec),
  );
  const durationSec = Math.max(params.mediaDurationSec ?? 0, inferredDuration);
  const totalSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const accumulator = new Int32Array(totalSamples);

  for (const segment of params.segments) {
    const wav = await readWavPcm16Mono(segment.wavPath);
    const source = resampleLinear(wav.samples, wav.sampleRate, sampleRate);

    const segmentStartIndex = Math.max(0, Math.round(segment.startSec * sampleRate));
    const targetWindowSamples = Math.max(1, Math.round((segment.endSec - segment.startSec) * sampleRate));
    const maxWritable = Math.max(0, totalSamples - segmentStartIndex);
    const writableCount = Math.min(source.length, targetWindowSamples, maxWritable);

    for (let sampleIndex = 0; sampleIndex < writableCount; sampleIndex += 1) {
      accumulator[segmentStartIndex + sampleIndex] += source[sampleIndex];
    }
  }

  const finalSamples = new Int16Array(totalSamples);
  for (let index = 0; index < totalSamples; index += 1) {
    finalSamples[index] = Math.max(-32768, Math.min(32767, accumulator[index]));
  }

  await writeWavPcm16Mono(params.outputWavPath, sampleRate, finalSamples);
}
