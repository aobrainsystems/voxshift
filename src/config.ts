import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import type { CliOptions, ModelTier, RuntimeConfig } from "./types.js";

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);

const cliOptionsSchema = z.object({
  input: z.string().min(1),
  sourceLanguage: z.string().min(1),
  targetLanguage: z.string().min(1),
  output: z.string().optional(),
  outputJson: z.string().optional(),
  modelTier: z.enum(["flash", "pro"]),
  voiceA: z.string().min(1),
  voiceB: z.string().optional(),
  transcribeModel: z.string().optional(),
  ttsModel: z.string().optional(),
  keepArtifacts: z.boolean(),
});

export function parseCliOptions(raw: unknown): CliOptions {
  return cliOptionsSchema.parse(raw);
}

function defaultOutputPath(inputPath: string, targetLanguage: string): string {
  const parsed = path.parse(inputPath);
  const ext = parsed.ext.toLowerCase();
  const baseName = `${parsed.name}_${targetLanguage}`;

  if (videoExtensions.has(ext)) {
    return path.join(parsed.dir, `${baseName}${ext}`);
  }

  return path.join(parsed.dir, `${baseName}.wav`);
}

function defaultOutputJsonPath(inputPath: string, targetLanguage: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}_${targetLanguage}_segments.json`);
}

export function resolveRuntimeConfig(options: CliOptions, workDir: string): RuntimeConfig {
  const inputAbsolutePath = path.resolve(workDir, options.input);

  if (!fs.existsSync(inputAbsolutePath)) {
    throw new Error(`Input file not found: ${inputAbsolutePath}`);
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  if (!googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not set. Add it to your environment or .env file.");
  }

  const artifactsDir = path.resolve(workDir, "artifacts", new Date().toISOString().replaceAll(":", "-"));
  const outputAbsolutePath = path.resolve(
    workDir,
    options.output ?? defaultOutputPath(inputAbsolutePath, options.targetLanguage),
  );
  const outputJsonAbsolutePath = path.resolve(
    workDir,
    options.outputJson ?? defaultOutputJsonPath(inputAbsolutePath, options.targetLanguage),
  );

  return {
    ...options,
    workDir,
    artifactsDir,
    inputAbsolutePath,
    outputAbsolutePath,
    outputJsonAbsolutePath,
    googleApiKey,
  };
}

export function defaultTranscribeModel(tier: ModelTier): string {
  return tier === "pro" ? "gemini-2.5-pro" : "gemini-2.5-flash";
}

export function defaultTtsModel(tier: ModelTier): string {
  return tier === "pro" ? "gemini-2.5-pro-preview-tts" : "gemini-2.5-flash-preview-tts";
}
