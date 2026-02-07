# VoxShift

Voxshift is a Gemini-first Node.js/TypeScript dubbing pipeline that transcribes, translates, and revoices audio/video with segment-aligned outputs.

Pipeline:
1. Extract audio from input media
2. Gemini multimodal transcription + translation
3. Gemini TTS synthesis per segment
4. Timeline composition aligned to source timestamps
5. Mux dubbed track back to video (or output audio if source is audio)

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` installed and available in `PATH`
- Google API key with Gemini access

### Install ffmpeg/ffprobe

macOS (Homebrew):
```bash
brew install ffmpeg
```

Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

Windows (winget):
```powershell
winget install Gyan.FFmpeg
```

## Setup

```bash
cp .env.example .env
```

Edit `.env`:
```env
GOOGLE_API_KEY=your_google_api_key_here
```

Install dependencies:
```bash
npm install
```

Build:
```bash
npm run build
```

Generate local fixture files:
```bash
npm run fixture:generate
```

## CLI Usage

```bash
npm run dev -- --input ../sample.mp4 --source-language en --target-language es --output ../sample_es.mp4
```

Or with built CLI:
```bash
npm run build
node dist/cli.js --input ../sample.mp4 --source-language en --target-language es --output ../sample_es.mp4
```

### Required options

- `--input <path>`: path to source media (video or audio)
- `--source-language <code>`: source language, example `en`
- `--target-language <code>`: target language, example `es`

### Optional options

- `--output <path>`: output media path
- `--output-json <path>`: JSON sidecar path for segments
- `--model-tier <flash|pro>`: default `flash`
- `--voice-a <voice>`: default `Kore`
- `--voice-b <voice>`: second speaker voice
- `--transcribe-model <name>`: override model for transcription+translation
- `--tts-model <name>`: override model for TTS
- `--keep-artifacts`: keep intermediate artifacts directory (default is auto-clean)

### Example commands

Video input:
```bash
node dist/cli.js \
  --input ../input.mp4 \
  --source-language en \
  --target-language fr \
  --output ../input_fr.mp4 \
  --output-json ../input_fr_segments.json
```

Audio input to MP3:
```bash
node dist/cli.js \
  --input ../podcast.wav \
  --source-language en \
  --target-language de \
  --output ../podcast_de.mp3
```

Use Pro tier and explicit voices:
```bash
node dist/cli.js \
  --input ../interview.mp4 \
  --source-language en \
  --target-language es \
  --model-tier pro \
  --voice-a Kore \
  --voice-b Puck \
  --output ../interview_es.mp4
```

## Programmatic Usage (Library)

```ts
import "dotenv/config";
import { runPipeline, resolveRuntimeConfig } from "voxshift-node";

const config = resolveRuntimeConfig(
  {
    input: "../input.mp4",
    sourceLanguage: "en",
    targetLanguage: "es",
    modelTier: "flash",
    voiceA: "Kore",
    voiceB: "Puck",
  },
  process.cwd(),
);

const result = await runPipeline(config);
console.log(result.outputPath);
```

For local use without publishing, import from built output:
```ts
import { runPipeline, resolveRuntimeConfig } from "./dist/index.js";
```

## Outputs

By default, the pipeline writes:

- Dubbed media output (`.mp4` for video sources, `.wav` unless you choose `.mp3` for audio sources)
- JSON sidecar with segments (`*_segments.json`)
- Source subtitles (`*.{sourceLanguage}.srt`)
- Translated subtitles (`*.{targetLanguage}.srt`)
- Intermediate artifacts under `artifacts/<timestamp>/`

By default, temporary artifacts are deleted after a successful run. Use `--keep-artifacts` if you want to inspect intermediate files.

## Automated Smoke Test

```bash
npm run smoke
```

What it does:
- Builds the package
- Generates deterministic local fixture files in `fixtures/`
- Creates synthetic per-segment audio
- Composes a final dubbed timeline
- Writes JSON and SRT outputs
- Verifies outputs are non-empty

Smoke artifacts:
- `artifacts/smoke/output/smoke_dubbed.wav`
- `artifacts/smoke/output/smoke_segments.json`
- `artifacts/smoke/output/smoke_source.srt`
- `artifacts/smoke/output/smoke_translated.srt`

## End-to-End Smoke Test (Gemini + ffmpeg)

```bash
npm run smoke:e2e
```

Preconditions:
- `GOOGLE_API_KEY` is set (in `nodejs/.env` or shell environment)
- `ffmpeg` and `ffprobe` are installed and available in `PATH`

What it does:
- Builds the package
- Uses real speech fixture `fixtures/sample_speech_12s.wav` (about 12 seconds)
- Runs the full real pipeline (`runPipeline`) including Gemini transcription/translation and Gemini TTS
- Writes real outputs under `artifacts/smoke-e2e/output/`
- Verifies output audio/JSON/SRT files are non-empty
- Asserts at least 2 transcript segments to avoid trivial single-segment results

## End-to-End Smoke Test (Pro model path)

Run:

```bash
npm run smoke:e2e:pro
```

Behavior:
- Forces `modelTier: pro` end-to-end path.
- Uses default Pro models unless overridden:
  - transcription: `gemini-2.5-pro`
  - TTS: `gemini-2.5-pro-preview-tts`
- Uses real speech fixture `fixtures/sample_speech_12s.wav` and expects at least 2 segments.
- Writes outputs to `artifacts/smoke-e2e-pro/output/`.

Optional CI overrides:
- `PRO_TRANSCRIBE_MODEL`
- `PRO_TTS_MODEL`

## End-to-End Smoke Test (Gemini 3 transcription model)

Run:

```bash
npm run smoke:e2e:gemini3
```

Behavior:
- Discovers an available Gemini 3 model using `models.list` and picks the best candidate.
- Runs full E2E pipeline with that Gemini 3 model for transcription/translation.
- Keeps Gemini TTS model unchanged (current TTS path still uses the configured TTS model).
- Uses real speech fixture `fixtures/sample_speech_12s.wav` and expects at least 2 segments.

Optional override:
- Set `GEMINI3_TRANSCRIBE_MODEL` to force a specific Gemini 3 model name.
- Example:
  - `GEMINI3_TRANSCRIBE_MODEL=gemini-3-pro npm run smoke:e2e:gemini3`

## CI Workflow

GitHub Actions workflow is included at:
- `.github/workflows/ci.yml`

It runs:
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run smoke` (local non-API smoke)

## Troubleshooting

- `ffmpeg` not found:
  - Install ffmpeg and confirm: `ffmpeg -version` and `ffprobe -version`
- `GOOGLE_API_KEY is not set`:
  - Add key to `.env` or shell env before running
- `401 Unauthorized` with `FileService.CreateFile` / `API keys are not supported by this API`:
  - Use a Gemini Developer API key from [Google AI Studio](https://aistudio.google.com/apikey) for API-key auth mode.
  - Current implementation uses inline media for files <= 20MB, so small inputs can avoid FileService upload entirely.
  - For larger inputs with Vertex auth, use OAuth2/ADC (service account or `gcloud auth application-default login`) instead of API key auth.
- Empty/invalid model response:
  - Retry with `--model-tier pro`
  - Try shorter input media
- JSON parse errors from transcription stage:
  - The pipeline now enforces response schema and strips wrapper text automatically.
  - Rebuild and rerun after updating: `npm run build && npm run smoke:e2e`
- Slow processing:
  - Use `flash` tier
  - Start with short clips for iteration

## V1 Scope Notes

This Node.js version intentionally skips advanced features for now:
- Background separation/mixing
- Pause-removal editing
- Emotion-conditioned synthesis
- Voice cloning
- Realtime streaming

The current implementation focuses on the stable, Google-only core dubbing flow.
