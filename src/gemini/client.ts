import { GoogleGenAI } from "@google/genai";

export function createGeminiClient(apiKey: string): GoogleGenAI {
  // Force Gemini Developer API mode to avoid accidental Vertex mode via env flags.
  return new GoogleGenAI({ apiKey, vertexai: false });
}
