import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeConfig } from "../config.js";
import { runPipeline } from "../pipeline.js";
import { generateFixtureFiles } from "./fixture.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  await generateFixtureFiles(projectRoot);
  const speechFixturePath = path.join(projectRoot, "fixtures", "sample_speech_12s.wav");
  await fs.access(speechFixturePath);

  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set. Add it to nodejs/.env or environment before running smoke:e2e.");
  }

  const outputDir = path.join(projectRoot, "artifacts", "smoke-e2e", "output");
  await fs.mkdir(outputDir, { recursive: true });

  const runtimeConfig = resolveRuntimeConfig(
    {
      input: "fixtures/sample_speech_12s.wav",
      sourceLanguage: "en",
      targetLanguage: "es",
      output: path.join(outputDir, "sample_speech_12s_es.wav"),
      outputJson: path.join(outputDir, "sample_speech_12s_es_segments.json"),
      modelTier: "flash",
      voiceA: "Kore",
      voiceB: "Puck",
      keepArtifacts: true,
    },
    projectRoot,
  );

  const result = await runPipeline(runtimeConfig);

  const sourceSrtPath = path.join(outputDir, "sample_speech_12s_es.en.srt");
  const translatedSrtPath = path.join(outputDir, "sample_speech_12s_es.es.srt");

  const [audioStat, jsonStat, sourceSrtStat, translatedSrtStat] = await Promise.all([
    fs.stat(result.outputPath),
    fs.stat(result.outputJsonPath),
    fs.stat(sourceSrtPath),
    fs.stat(translatedSrtPath),
  ]);

  assert(audioStat.size > 44, "E2E smoke failed: output audio is empty.");
  assert(jsonStat.size > 20, "E2E smoke failed: output JSON is empty.");
  assert(sourceSrtStat.size > 20, "E2E smoke failed: source SRT is empty.");
  assert(translatedSrtStat.size > 20, "E2E smoke failed: translated SRT is empty.");
  assert(result.segments.length >= 2, "E2E smoke failed: expected at least 2 segments from speech fixture.");

  console.log("E2E smoke test passed.");
  console.log(`- ${result.outputPath}`);
  console.log(`- ${result.outputJsonPath}`);
  console.log(`- ${sourceSrtPath}`);
  console.log(`- ${translatedSrtPath}`);
  console.log(`- segments: ${result.segments.length}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E smoke test failed: ${message}`);
  process.exitCode = 1;
});
