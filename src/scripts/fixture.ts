import fs from "node:fs/promises";
import path from "node:path";
import type { Segment } from "../types.js";
import { writeWavPcm16Mono } from "../audio/wav.js";

const FIXTURE_SAMPLE_RATE = 16000;

function clamp16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function buildTone(durationSec: number, frequencyHz: number, sampleRate = FIXTURE_SAMPLE_RATE): Int16Array {
  const totalSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const samples = new Int16Array(totalSamples);

  const attackSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const releaseSamples = Math.max(1, Math.round(sampleRate * 0.02));

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const base = Math.sin(2 * Math.PI * frequencyHz * t);

    let envelope = 1;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else if (i > totalSamples - releaseSamples) {
      envelope = (totalSamples - i) / releaseSamples;
    }

    const amplitude = 0.35;
    samples[i] = clamp16(base * envelope * amplitude * 32767);
  }

  return samples;
}

function appendBuffers(buffers: Int16Array[]): Int16Array {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const merged = new Int16Array(totalLength);

  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }

  return merged;
}

function silence(durationSec: number, sampleRate = FIXTURE_SAMPLE_RATE): Int16Array {
  const count = Math.max(1, Math.round(durationSec * sampleRate));
  return new Int16Array(count);
}

export function buildSampleSegments(): Segment[] {
  return [
    {
      speaker: "SPEAKER_01",
      startSec: 0.5,
      endSec: 1.8,
      sourceText: "Hello and welcome to this short demo.",
      translatedText: "Hola y bienvenido a esta demo corta.",
    },
    {
      speaker: "SPEAKER_02",
      startSec: 2.1,
      endSec: 3.8,
      sourceText: "We are testing the Node dubbing pipeline.",
      translatedText: "Estamos probando el pipeline de doblaje en Node.",
    },
  ];
}

export async function generateFixtureFiles(baseDir: string): Promise<{ inputWavPath: string; segmentsJsonPath: string }> {
  const fixtureDir = path.resolve(baseDir, "fixtures");
  await fs.mkdir(fixtureDir, { recursive: true });

  const segments = buildSampleSegments();
  const segmentsJsonPath = path.join(fixtureDir, "sample_segments.json");
  await fs.writeFile(segmentsJsonPath, JSON.stringify({ segments }, null, 2), "utf8");

  // This is deterministic synthetic audio (not speech) used as an input fixture for file handling.
  const composed = appendBuffers([
    silence(0.45),
    buildTone(1.0, 440),
    silence(0.3),
    buildTone(1.2, 554),
    silence(1.2),
  ]);

  const inputWavPath = path.join(fixtureDir, "sample_input.wav");
  await writeWavPcm16Mono(inputWavPath, FIXTURE_SAMPLE_RATE, composed);

  return { inputWavPath, segmentsJsonPath };
}
