import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { loadYouTubePolicy } from "../youtube/policy.js";
import { runYouTubeIntake } from "../youtube/intake.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("youtube-intake")
    .description("Run YouTube intake policy checks and emit a decision artifact")
    .requiredOption("--source-url <url>", "Source YouTube URL")
    .option("--policy-config <path>", "Policy JSON path", "config/youtubePolicy.json")
    .option("--region-code <code>", "Region code used for restriction checks", "US")
    .option("--artifacts-dir <path>", "Intake artifact output directory", "artifacts/intake");

  program.parse(process.argv);
  const options = program.opts<{
    sourceUrl: string;
    policyConfig: string;
    regionCode: string;
    artifactsDir: string;
  }>();

  const dataApiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!dataApiKey) {
    throw new Error("YOUTUBE_DATA_API_KEY is not set. Add it to .env or shell environment.");
  }

  const cwd = process.cwd();
  const { path: policyPath, policy } = await loadYouTubePolicy(options.policyConfig, cwd);

  const intake = await runYouTubeIntake({
    sourceUrl: options.sourceUrl,
    dataApiKey,
    policyPath,
    policy,
    regionCode: options.regionCode,
    artifactsDir: path.resolve(cwd, options.artifactsDir),
  });

  console.log(`YouTube intake decision: ${intake.result.decision}`);
  console.log(`Artifact: ${intake.artifactPath}`);

  for (const reason of intake.result.reasons) {
    console.log(`- [${reason.severity}] ${reason.code}: ${reason.message}`);
  }

  if (intake.result.decision !== "allow") {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`YouTube intake failed: ${message}`);
  process.exitCode = 1;
});
