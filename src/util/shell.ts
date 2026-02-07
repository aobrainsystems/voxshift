import { spawn } from "node:child_process";

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], cwd: string): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr.trim()}`));
    });
  });
}
