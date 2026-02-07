import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createGeminiClient } from "../gemini/client.js";
import { resolveRuntimeConfig } from "../config.js";
import { runPipeline } from "../pipeline.js";
import { generateFixtureFiles } from "./fixture.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
      const waitMs = 700 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function normalizeModelName(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function scoreGemini3Model(modelName: string): number {
  const lower = modelName.toLowerCase();
  let score = 0;

  if (lower.includes("gemini-3")) score += 100;
  if (lower.includes("pro")) score += 30;
  if (lower.includes("flash")) score += 20;
  if (lower.includes("preview")) score += 5;
  if (lower.includes("experimental")) score -= 10;

  return score;
}

async function discoverGemini3TranscribeModel(apiKey: string): Promise<string> {
  const override = process.env.GEMINI3_TRANSCRIBE_MODEL?.trim();
  if (override) {
    return normalizeModelName(override);
  }

  const client = createGeminiClient(apiKey);
  const pager = await withRetry(async () => {
    return client.models.list({
      config: {
        queryBase: true,
        pageSize: 100,
      },
    });
  });

  const candidates: string[] = [];

  for await (const model of pager) {
    const name = model.name?.trim();
    if (!name) {
      continue;
    }

    const normalized = normalizeModelName(name);
    if (!normalized.toLowerCase().includes("gemini-3")) {
      continue;
    }

    candidates.push(normalized);

    // Limit scanning to keep this discovery step fast.
    if (candidates.length >= 30) {
      break;
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "No Gemini 3 model was discovered for this key. Set GEMINI3_TRANSCRIBE_MODEL explicitly.",
    );
  }

  const uniqueSorted = [...new Set(candidates)].sort((a, b) => {
    const scoreDelta = scoreGemini3Model(b) - scoreGemini3Model(a);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return a.localeCompare(b);
  });

  return uniqueSorted[0];
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  await generateFixtureFiles(projectRoot);
  const speechFixturePath = path.join(projectRoot, "fixtures", "sample_speech_12s.wav");
  await fs.access(speechFixturePath);

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set. Add it to nodejs/.env or environment before running smoke:e2e:gemini3.");
  }

  const transcribeModel = await discoverGemini3TranscribeModel(apiKey);

  const outputDir = path.join(projectRoot, "artifacts", "smoke-e2e-gemini3", "output");
  await fs.mkdir(outputDir, { recursive: true });

  const runtimeConfig = resolveRuntimeConfig(
    {
      input: "fixtures/sample_speech_12s.wav",
      sourceLanguage: "en",
      targetLanguage: "es",
      output: path.join(outputDir, "sample_speech_12s_es.wav"),
      outputJson: path.join(outputDir, "sample_speech_12s_es_segments.json"),
      modelTier: "flash",
      transcribeModel,
      voiceA: "Kore",
      voiceB: "Puck",
      keepArtifacts: true,
    },
    projectRoot,
  );

  const result = await withRetry(async () => runPipeline(runtimeConfig), 2);

  const sourceSrtPath = path.join(outputDir, "sample_speech_12s_es.en.srt");
  const translatedSrtPath = path.join(outputDir, "sample_speech_12s_es.es.srt");

  const [audioStat, jsonStat, sourceSrtStat, translatedSrtStat] = await Promise.all([
    fs.stat(result.outputPath),
    fs.stat(result.outputJsonPath),
    fs.stat(sourceSrtPath),
    fs.stat(translatedSrtPath),
  ]);

  assert(audioStat.size > 44, "Gemini 3 E2E smoke failed: output audio is empty.");
  assert(jsonStat.size > 20, "Gemini 3 E2E smoke failed: output JSON is empty.");
  assert(sourceSrtStat.size > 20, "Gemini 3 E2E smoke failed: source SRT is empty.");
  assert(translatedSrtStat.size > 20, "Gemini 3 E2E smoke failed: translated SRT is empty.");
  assert(result.segments.length >= 2, "Gemini 3 E2E smoke failed: expected at least 2 segments from speech fixture.");

  console.log("Gemini 3 E2E smoke test passed.");
  console.log(`- transcribeModel: ${transcribeModel}`);
  console.log(`- ${result.outputPath}`);
  console.log(`- ${result.outputJsonPath}`);
  console.log(`- ${sourceSrtPath}`);
  console.log(`- ${translatedSrtPath}`);
  console.log(`- segments: ${result.segments.length}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("fetch failed")) {
    console.error(
      "Gemini 3 E2E smoke test failed due network/auth reachability (fetch failed). " +
        "Verify internet access, API key validity, and model availability, then rerun.",
    );
  }
  console.error(`Gemini 3 E2E smoke test failed: ${message}`);
  process.exitCode = 1;
});
