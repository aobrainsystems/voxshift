import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { YouTubePolicy } from "./types.js";

const youtubePolicySchema = z.object({
  allowOnlySourceChannelIds: z.array(z.string().min(1)).min(1),
  allowRiskOverride: z.boolean(),
  blockIfNotPublic: z.boolean(),
  blockIfRegionRestricted: z.boolean(),
  blockIfNotEmbeddable: z.boolean(),
  blockMusicCategoryAsSoftRisk: z.boolean(),
  requireDefaultAudioLanguage: z.boolean(),
});

export async function loadYouTubePolicy(policyPath: string, cwd: string): Promise<{ path: string; policy: YouTubePolicy }> {
  const resolvedPath = path.resolve(cwd, policyPath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const policy = youtubePolicySchema.parse(parsed);
  return { path: resolvedPath, policy };
}
