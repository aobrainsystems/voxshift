export type ModelTier = "flash" | "pro";

export interface CliOptions {
  input: string;
  sourceLanguage: string;
  targetLanguage: string;
  output?: string;
  outputJson?: string;
  modelTier: ModelTier;
  voiceA: string;
  voiceB?: string;
  transcribeModel?: string;
  ttsModel?: string;
  keepArtifacts: boolean;
}

export interface RuntimeConfig extends CliOptions {
  workDir: string;
  artifactsDir: string;
  inputAbsolutePath: string;
  outputAbsolutePath: string;
  outputJsonAbsolutePath: string;
  googleApiKey: string;
}

export interface MediaInfo {
  path: string;
  durationSec: number;
  isVideo: boolean;
  audioCodec?: string;
  videoCodec?: string;
}

export interface Segment {
  speaker: string;
  startSec: number;
  endSec: number;
  sourceText: string;
  translatedText: string;
}

export interface PipelineResult {
  mediaInfo: MediaInfo;
  segments: Segment[];
  extractedAudioPath: string;
  dubbedAudioPath: string;
  outputPath: string;
  outputJsonPath: string;
}
