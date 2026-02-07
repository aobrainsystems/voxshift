#!/usr/bin/env node

import "dotenv/config";
import process from "node:process";
import { Command } from "commander";
import { parseCliOptions, resolveRuntimeConfig } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("voxshift-node")
    .description("Gemini-first Node.js dubbing pipeline")
    .requiredOption("-i, --input <path>", "Input media file path")
    .requiredOption("--source-language <code>", "Source language code, e.g. en")
    .requiredOption("--target-language <code>", "Target language code, e.g. es")
    .option("-o, --output <path>", "Output media file path")
    .option("--output-json <path>", "Output JSON sidecar path")
    .option("--model-tier <tier>", "Gemini model tier: flash or pro", "flash")
    .option("--voice-a <voice>", "Primary Gemini voice name", "Kore")
    .option("--voice-b <voice>", "Secondary Gemini voice name")
    .option("--transcribe-model <model>", "Override transcription+translation model")
    .option("--tts-model <model>", "Override TTS model")
    .option("--keep-artifacts", "Do not remove temporary artifacts after run", false)
    .addHelpText(
      "after",
      [
        "",
        "Example:",
        "  voxshift-node --input ./input.mp4 --source-language en --target-language es --output ./output_es.mp4",
      ].join("\n"),
    );

  program.parse(process.argv);

  const raw = program.opts();
  const parsed = parseCliOptions({
    input: raw.input,
    sourceLanguage: raw.sourceLanguage,
    targetLanguage: raw.targetLanguage,
    output: raw.output,
    outputJson: raw.outputJson,
    modelTier: raw.modelTier,
    voiceA: raw.voiceA,
    voiceB: raw.voiceB,
    transcribeModel: raw.transcribeModel,
    ttsModel: raw.ttsModel,
    keepArtifacts: Boolean(raw.keepArtifacts),
  });

  const runtimeConfig = resolveRuntimeConfig(parsed, process.cwd());

  logger.info(
    {
      input: runtimeConfig.inputAbsolutePath,
      output: runtimeConfig.outputAbsolutePath,
      outputJson: runtimeConfig.outputJsonAbsolutePath,
      artifactsDir: runtimeConfig.artifactsDir,
    },
    "Resolved runtime configuration",
  );

  const result = await runPipeline(runtimeConfig);

  logger.info(
    {
      output: result.outputPath,
      outputJson: result.outputJsonPath,
      segments: result.segments.length,
      artifactsDir: runtimeConfig.artifactsDir,
    },
    "Done",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: message }, "Pipeline failed");
  process.exitCode = 1;
});
