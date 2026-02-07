import fs from "node:fs/promises";
import path from "node:path";
import type { Segment } from "../types.js";

function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function writeSegmentsJson(params: {
  outputPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  inputPath: string;
  segments: Segment[];
}): Promise<void> {
  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });

  const payload = {
    createdAt: new Date().toISOString(),
    inputPath: params.inputPath,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    segments: params.segments,
  };

  await fs.writeFile(params.outputPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function writeSrt(params: {
  outputPath: string;
  segments: Segment[];
  field: "sourceText" | "translatedText";
}): Promise<void> {
  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });

  const lines: string[] = [];

  for (let index = 0; index < params.segments.length; index += 1) {
    const segment = params.segments[index];
    lines.push(String(index + 1));
    lines.push(`${formatSrtTimestamp(segment.startSec)} --> ${formatSrtTimestamp(segment.endSec)}`);
    lines.push(segment[params.field]);
    lines.push("");
  }

  await fs.writeFile(params.outputPath, lines.join("\n"), "utf8");
}
