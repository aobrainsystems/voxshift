import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Type, type GoogleGenAI, type Schema } from "@google/genai";
import type { Segment } from "../types.js";

const modelResponseSchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.string().min(1),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
        sourceText: z.string().min(1),
        translatedText: z.string().min(1),
      }),
    )
    .min(1),
});

const MAX_INLINE_AUDIO_BYTES = 20 * 1024 * 1024;

const GEMINI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["segments"],
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["speaker", "startSec", "endSec", "sourceText", "translatedText"],
        properties: {
          speaker: { type: Type.STRING },
          startSec: { type: Type.NUMBER },
          endSec: { type: Type.NUMBER },
          sourceText: { type: Type.STRING },
          translatedText: { type: Type.STRING },
        },
      },
    },
  },
};

function buildPrompt(sourceLanguage: string, targetLanguage: string): string {
  return [
    "You are a dubbing transcription and translation engine.",
    `Transcribe spoken audio from ${sourceLanguage} and translate into ${targetLanguage}.`,
    "Return JSON only.",
    "Output shape:",
    '{"segments":[{"speaker":"SPEAKER_01","startSec":0.0,"endSec":2.3,"sourceText":"...","translatedText":"..."}]}',
    "Rules:",
    "1) Keep startSec/endSec as numeric seconds.",
    "2) Keep chronological order.",
    "3) Keep translation concise to help speech timing.",
    "4) Keep punctuation natural for speech synthesis.",
    "5) Use speaker labels consistently.",
  ].join("\n");
}

function unwrapJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split("\n");
  if (lines.length <= 2) {
    return trimmed;
  }

  return lines.slice(1, -1).join("\n").trim();
}

function extractLikelyJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw;
}

function normalizeSegments(segments: Segment[]): Segment[] {
  const normalized = segments
    .filter((segment) => segment.endSec > segment.startSec)
    .map((segment) => ({
      ...segment,
      speaker: segment.speaker.trim() || "SPEAKER_01",
      sourceText: segment.sourceText.trim(),
      translatedText: segment.translatedText.trim(),
    }))
    .filter((segment) => segment.sourceText.length > 0 && segment.translatedText.length > 0)
    .sort((a, b) => a.startSec - b.startSec);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startSec < normalized[index - 1].startSec) {
      normalized[index].startSec = normalized[index - 1].startSec;
    }
    if (normalized[index].endSec <= normalized[index].startSec) {
      normalized[index].endSec = normalized[index].startSec + 0.1;
    }
  }

  return normalized;
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
      const waitMs = 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }

  throw lastError;
}

function looksLikeApiKeyNotSupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("api keys are not supported by this api") ||
    message.includes("credentials_missing") ||
    message.includes("unauthenticated")
  );
}

function detectMimeType(audioPath: string): string {
  const ext = path.extname(audioPath).toLowerCase();
  if (ext === ".mp3") {
    return "audio/mpeg";
  }
  if (ext === ".flac") {
    return "audio/flac";
  }
  if (ext === ".m4a") {
    return "audio/mp4";
  }
  if (ext === ".ogg" || ext === ".oga") {
    return "audio/ogg";
  }
  return "audio/wav";
}

async function buildAudioPart(params: {
  client: GoogleGenAI;
  audioPath: string;
}): Promise<{ inlineData?: { data: string; mimeType: string }; fileData?: { fileUri: string; mimeType: string } }> {
  const stat = await fs.stat(params.audioPath);
  const mimeType = detectMimeType(params.audioPath);

  // Prefer inline for small media to avoid FileService auth differences and reduce round-trips.
  if (stat.size <= MAX_INLINE_AUDIO_BYTES) {
    const data = await fs.readFile(params.audioPath);
    return {
      inlineData: {
        data: data.toString("base64"),
        mimeType,
      },
    };
  }

  try {
    const upload = await withRetry(async () => {
      return params.client.files.upload({
        file: params.audioPath,
        config: {
          mimeType,
        },
      });
    });
    if (!upload.uri) {
      throw new Error("File upload succeeded but did not return file URI.");
    }

    return {
      fileData: {
        fileUri: upload.uri,
        mimeType: upload.mimeType ?? mimeType,
      },
    };
  } catch (error) {
    if (looksLikeApiKeyNotSupportedError(error)) {
      throw new Error(
        "This key cannot use Gemini FileService upload. Use a Google AI Studio Gemini API key, " +
          "or configure OAuth2/ADC for Vertex AI auth, or keep inputs <= 20MB for inline mode.",
      );
    }
    throw error;
  }
}

export async function transcribeAndTranslateAudio(params: {
  client: GoogleGenAI;
  audioPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  model: string;
}): Promise<Segment[]> {
  const audioPart = await buildAudioPart({
    client: params.client,
    audioPath: params.audioPath,
  });
  const prompt = buildPrompt(params.sourceLanguage, params.targetLanguage);

  const response = await withRetry(async () => {
    return params.client.models.generateContent({
      model: params.model,
      contents: [
        audioPart,
        {
          text: prompt,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    });
  });

  const text = (response.text ?? "").trim();
  if (!text) {
    throw new Error("Gemini returned empty transcription response.");
  }

  const jsonText = extractLikelyJson(unwrapJsonText(text));
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new Error(
      `Gemini returned invalid JSON for transcription payload. ` +
        `Try rerunning; if persistent, switch to --model-tier pro. ` +
        `Parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const validated = modelResponseSchema.parse(parsed);

  const segments = normalizeSegments(validated.segments);
  if (segments.length === 0) {
    throw new Error("No valid segments were produced by Gemini.");
  }

  return segments;
}
