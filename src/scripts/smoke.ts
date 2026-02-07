import fs from "node:fs/promises";
import path from "node:path";
import type { Segment } from "../types.js";
import { writeWavPcm16Mono } from "../audio/wav.js";
import { composeDubbedTimeline } from "../audio/timeline.js";
import { writeSegmentsJson, writeSrt } from "../output/write.js";
import type { SynthesizedSegment } from "../gemini/tts.js";
import { buildSampleSegments, generateFixtureFiles } from "./fixture.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildSyntheticSpeechLikeSamples(durationSec: number, frequencyHz: number, sampleRate = 24000): Int16Array {
  const total = Math.max(1, Math.round(durationSec * sampleRate));
  const out = new Int16Array(total);

  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const carrier = Math.sin(2 * Math.PI * frequencyHz * t);
    const modulator = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    out[i] = Math.round(carrier * modulator * 0.3 * 32767);
  }

  return out;
}

async function buildSyntheticSegmentAudio(outputDir: string, segments: Segment[]): Promise<SynthesizedSegment[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const result: SynthesizedSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const toneDuration = Math.max(0.4, Math.min(segment.endSec - segment.startSec - 0.1, 1.2));
    const toneFrequency = index % 2 === 0 ? 330 : 410;
    const samples = buildSyntheticSpeechLikeSamples(toneDuration, toneFrequency, 24000);
    const wavPath = path.join(outputDir, `${String(index).padStart(5, "0")}.wav`);

    await writeWavPcm16Mono(wavPath, 24000, samples);

    result.push({
      index,
      speaker: segment.speaker,
      startSec: segment.startSec,
      endSec: segment.endSec,
      translatedText: segment.translatedText,
      wavPath,
      sampleRate: 24000,
      durationSec: samples.length / 24000,
    });
  }

  return result;
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  await generateFixtureFiles(projectRoot);

  const artifactsDir = path.join(projectRoot, "artifacts", "smoke");
  const outputDir = path.join(artifactsDir, "output");
  const segmentsDir = path.join(artifactsDir, "segments");
  await fs.rm(artifactsDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const segments = buildSampleSegments();
  const synthesizedSegments = await buildSyntheticSegmentAudio(segmentsDir, segments);

  const dubbedWavPath = path.join(outputDir, "smoke_dubbed.wav");
  await composeDubbedTimeline({
    segments: synthesizedSegments,
    outputWavPath: dubbedWavPath,
    mediaDurationSec: 4.2,
  });

  const segmentsJsonPath = path.join(outputDir, "smoke_segments.json");
  const sourceSrtPath = path.join(outputDir, "smoke_source.srt");
  const translatedSrtPath = path.join(outputDir, "smoke_translated.srt");

  await writeSegmentsJson({
    outputPath: segmentsJsonPath,
    sourceLanguage: "en",
    targetLanguage: "es",
    inputPath: path.join(projectRoot, "fixtures", "sample_input.wav"),
    segments,
  });

  await writeSrt({ outputPath: sourceSrtPath, segments, field: "sourceText" });
  await writeSrt({ outputPath: translatedSrtPath, segments, field: "translatedText" });

  const [wavStat, jsonStat, sourceSrtStat, translatedSrtStat] = await Promise.all([
    fs.stat(dubbedWavPath),
    fs.stat(segmentsJsonPath),
    fs.stat(sourceSrtPath),
    fs.stat(translatedSrtPath),
  ]);

  assert(wavStat.size > 44, "Smoke failed: dubbed WAV output is empty.");
  assert(jsonStat.size > 20, "Smoke failed: segment JSON output is empty.");
  assert(sourceSrtStat.size > 20, "Smoke failed: source SRT output is empty.");
  assert(translatedSrtStat.size > 20, "Smoke failed: translated SRT output is empty.");

  console.log("Smoke test passed.");
  console.log(`- ${dubbedWavPath}`);
  console.log(`- ${segmentsJsonPath}`);
  console.log(`- ${sourceSrtPath}`);
  console.log(`- ${translatedSrtPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exitCode = 1;
});
