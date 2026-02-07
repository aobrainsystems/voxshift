import path from "node:path";
import { generateFixtureFiles } from "./fixture.js";

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.cwd());
  const result = await generateFixtureFiles(projectRoot);

  console.log("Fixture generated:");
  console.log(`- ${result.inputWavPath}`);
  console.log(`- ${result.segmentsJsonPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to generate fixture: ${message}`);
  process.exitCode = 1;
});
