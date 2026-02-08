# VoxShift

VoxShift is a Gemini-first Node.js/TypeScript dubbing pipeline that transcribes, translates, and revoices audio/video with segment-aligned outputs.

Pipeline:
1. Extract audio from input media
2. Gemini multimodal transcription + translation
3. Gemini TTS synthesis per segment
4. Timeline composition aligned to source timestamps
5. Mux dubbed track back to video (or output audio if source is audio)

YouTube extension (current scope):
1. Intake assistant for URL metadata/license checks and policy-based blocking
2. Optional upload of processed output to a target channel as `private`

Out of scope for this phase:
- Auto-downloading source media from arbitrary YouTube links
- Automatic public publishing
- Advanced legal/Content-ID automation

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` installed and available in `PATH`
- Google API key with Gemini access

For YouTube flow:
- YouTube Data API key (for intake checks)
- Google OAuth client + refresh token (for uploads)

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
YOUTUBE_DATA_API_KEY=your_youtube_data_api_key_here
YOUTUBE_OAUTH_CLIENT_ID=your_oauth_client_id_here
YOUTUBE_OAUTH_CLIENT_SECRET=your_oauth_client_secret_here
YOUTUBE_OAUTH_REFRESH_TOKEN=your_oauth_refresh_token_here

# Optional profile-scoped credentials (used with --channel-profile main)
# YOUTUBE_OAUTH_CLIENT_ID_MAIN=your_oauth_client_id_here
# YOUTUBE_OAUTH_CLIENT_SECRET_MAIN=your_oauth_client_secret_here
# YOUTUBE_OAUTH_REFRESH_TOKEN_MAIN=your_oauth_refresh_token_here
```

## Credential Setup (Detailed)

This section explains how to obtain every `.env` credential used by VoxShift.

### `GOOGLE_API_KEY` (Gemini Developer API key)

Official reference:
- [Using Gemini API keys](https://ai.google.dev/tutorials/setup)
- [Gemini API quickstart](https://ai.google.dev/gemini-api/docs/quickstart)

Steps:
1. Open [Google AI Studio API keys](https://aistudio.google.com/apikey).
2. Select an existing Google Cloud project or create/import one in AI Studio.
3. Click **Create API key** and copy the generated key.
4. Put it into `.env` as `GOOGLE_API_KEY`.

Notes:
- This project uses Gemini Developer API key auth mode (`@google/genai` with `vertexai: false`).
- Treat this key as a secret and do not commit it.

### `YOUTUBE_DATA_API_KEY` (YouTube metadata/intake key)

Official reference:
- [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started)
- [Obtaining authorization credentials](https://developers.google.com/youtube/registering_an_application)
- [Manage API keys](https://docs.cloud.google.com/docs/authentication/api-keys)

Steps:
1. Open [Google Cloud Console](https://console.cloud.google.com/) and select the project you use for VoxShift.
2. Enable **YouTube Data API v3**:
   - APIs & Services -> Library -> search for `YouTube Data API v3` -> Enable.
3. Create an API key:
   - APIs & Services -> Credentials -> Create credentials -> API key.
4. Restrict the key (recommended):
   - API restrictions: allow only `YouTube Data API v3`.
   - Application restrictions:
     - `IP addresses` for server/CI usage, or
     - `Websites` if you only call from allowed origins.
5. Put it into `.env` as `YOUTUBE_DATA_API_KEY`.

### `YOUTUBE_OAUTH_CLIENT_ID` + `YOUTUBE_OAUTH_CLIENT_SECRET` (upload OAuth app)

Official reference:
- [Implementing OAuth 2.0 Authorization (YouTube)](https://developers.google.com/youtube/v3/guides/authentication)
- [OAuth 2.0 for web server apps (YouTube)](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)

Steps:
1. In Google Cloud Console, open **Google Auth Platform** (or APIs & Services -> OAuth consent screen).
2. Configure OAuth consent screen:
   - Choose `Internal` (Workspace-only) or `External`.
   - Add app name/support email/developer contact.
   - If `External` in testing mode, add your Google account as a Test User.
3. Create OAuth client:
   - APIs & Services -> Credentials -> Create credentials -> OAuth client ID.
   - Application type: **Web application**.
4. Add this Authorized redirect URI:
   - `https://developers.google.com/oauthplayground`
5. Copy Client ID and Client Secret into `.env`:
   - `YOUTUBE_OAUTH_CLIENT_ID`
   - `YOUTUBE_OAUTH_CLIENT_SECRET`

### `YOUTUBE_OAUTH_REFRESH_TOKEN` (offline token for private uploads)

Why needed:
- VoxShift uploads with background-compatible OAuth refresh flow (no interactive login during runtime).

Steps (OAuth Playground method):
1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the settings gear and enable **Use your own OAuth credentials**.
3. Paste your OAuth Client ID and Client Secret from `.env`.
4. In Step 1, select BOTH scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
5. Click **Authorize APIs** and sign in with the target YouTube channel owner account.
6. Click **Exchange authorization code for tokens**.
7. Copy the `refresh_token` and put it into `.env` as `YOUTUBE_OAUTH_REFRESH_TOKEN`.

Security and lifecycle notes:
- Keep refresh token private and rotate if compromised.
- If refresh token stops working (`invalid_grant`), repeat the consent flow to issue a new one.
- After token creation, you can remove OAuth Playground redirect URI from the OAuth client if you do not need it again.

Optional multi-channel profile variables:
- You can maintain multiple upload credential sets by suffixing env vars.
- Example for `--channel-profile main`:
  - `YOUTUBE_OAUTH_CLIENT_ID_MAIN`
  - `YOUTUBE_OAUTH_CLIENT_SECRET_MAIN`
  - `YOUTUBE_OAUTH_REFRESH_TOKEN_MAIN`

### Quick credential verification checklist

1. Gemini key check:
   - run `npm run smoke:e2e` (requires `GOOGLE_API_KEY` and ffmpeg)
2. YouTube Data API key check:
   - run `npm run youtube:intake -- --source-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
3. OAuth refresh token check:
   - test token exchange manually:
```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$YOUTUBE_OAUTH_CLIENT_ID" \
  -d "client_secret=$YOUTUBE_OAUTH_CLIENT_SECRET" \
  -d "refresh_token=$YOUTUBE_OAUTH_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```
Success response should include an `access_token`.

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

## Core CLI Usage

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

## YouTube Flow (Pipeline + Upload-Only)

`youtube:run` now supports two modes:
- `pipeline` (default): run dubbing pipeline, then optionally upload
- `upload-only`: upload an existing local video with explicit metadata

`--source-url` is optional. If provided, intake checks run before publish.

### 1. Configure policy allowlist (used when `--source-url` is provided)

Edit `config/youtubePolicy.json` and replace placeholder channel IDs:

```json
{
  "allowOnlySourceChannelIds": ["UCxxxxxxxxxxxxxxxxxxxxxx"],
  "allowRiskOverride": true,
  "blockIfNotPublic": true,
  "blockIfRegionRestricted": true,
  "blockIfNotEmbeddable": true,
  "blockMusicCategoryAsSoftRisk": true,
  "requireDefaultAudioLanguage": true
}
```

### 2. Run intake-only policy check

```bash
npm run youtube:intake -- \
  --source-url "https://www.youtube.com/watch?v=VIDEO_ID"
```

Outputs:
- decision printed to console
- artifact JSON at `artifacts/intake/<videoId>.json`

Exit code:
- `0` for `allow`
- `2` for `soft_block` or `hard_block`
- `1` for execution failures

### 3. Pipeline mode with source URL (intake + dubbing + upload)

```bash
npm run youtube:run -- \
  --mode pipeline \
  --source-url "https://www.youtube.com/watch?v=VIDEO_ID" \
  --input /absolute/path/to/local_source_video.mp4 \
  --source-language en \
  --target-language es \
  --target-channel-id UC_TARGET_CHANNEL_ID \
  --output /absolute/path/to/output_es.mp4
```

### 4. Pipeline mode without source URL

`--source-url` is optional. Intake is skipped in this case.

```bash
npm run youtube:run -- \
  --mode pipeline \
  --input /absolute/path/to/local_source_video.mp4 \
  --source-language en \
  --target-language es \
  --target-channel-id UC_TARGET_CHANNEL_ID \
  --approval-reason "original content rights verified by operator"
```

### 5. Upload-only mode (existing local video + metadata)

```bash
npm run youtube:run -- \
  --mode upload-only \
  --upload-file /absolute/path/to/local_source_video.mp4 \
  --target-channel-id UC_TARGET_CHANNEL_ID \
  --title "Custom title" \
  --description "Custom description" \
  --tags "dub,spanish,voxshift" \
  --privacy-status private
```

### 6. Metadata file input

Pass metadata via JSON file:

```bash
npm run youtube:run -- \
  --mode upload-only \
  --upload-file /absolute/path/to/existing_video.mp4 \
  --target-channel-id UC_TARGET_CHANNEL_ID \
  --metadata-file ./metadata.json
```

Example `metadata.json`:

```json
{
  "title": "My Dubbed Video",
  "description": "Produced with VoxShift",
  "tags": ["dub", "es", "voiceover"],
  "categoryId": "22",
  "privacyStatus": "private",
  "defaultLanguage": "es",
  "defaultAudioLanguage": "es",
  "madeForKids": false,
  "playlistId": "PLxxxxxxxxxxxxxxxx"
}
```

CLI metadata flags override values from `--metadata-file`.

### 7. Channel-specific publishing

Upload requires `--target-channel-id`. The command validates that the OAuth credentials resolve to the same channel ID before upload.

Optional channel profile:
- `--channel-profile main` loads:
  - `YOUTUBE_OAUTH_CLIENT_ID_MAIN`
  - `YOUTUBE_OAUTH_CLIENT_SECRET_MAIN`
  - `YOUTUBE_OAUTH_REFRESH_TOKEN_MAIN`
- If profile vars are missing, command falls back to default `YOUTUBE_OAUTH_*` values.

### 8. Duplicate protection and dry-run

Duplicate protection:
- If `sourceVideoId` exists, duplicate key is `sourceVideoId + targetLanguage + targetChannelId`.
- Otherwise duplicate key is `uploadFileSha256 + targetChannelId`.
- Use `--force-upload` to bypass.

Dry-run upload (auth + channel validation + metadata resolution, no upload):

```bash
npm run youtube:run -- \
  --mode upload-only \
  --upload-file /absolute/path/to/existing_video.mp4 \
  --target-channel-id UC_TARGET_CHANNEL_ID \
  --metadata-file ./metadata.json \
  --dry-run-upload
```

### 9. Full `youtube:run` options

Core mode/source:
- `--mode <pipeline|upload-only>`: execution mode (default `pipeline`)
- `--source-url <url>`: optional source YouTube URL for intake checks
- `--approval-reason <text>`: required for intake soft-risk approval, and required in pipeline mode when `--source-url` is omitted

Pipeline options (`--mode pipeline`):
- `--input <path>`: local pipeline input media (required)
- `--source-language <code>`: required
- `--target-language <code>`: recommended; required for normal dubbing behavior
- `--output <path>`: output media path
- `--output-json <path>`: output JSON path
- `--model-tier <flash|pro>`: default `flash`
- `--voice-a <voice>`: default `Kore`
- `--voice-b <voice>`: optional secondary voice
- `--transcribe-model <model>`: override transcription model
- `--tts-model <model>`: override TTS model
- `--keep-artifacts`: keep temporary pipeline artifacts

Upload-only options (`--mode upload-only`):
- `--upload-file <path>`: local video path to publish (required)

Intake/policy options:
- `--policy-config <path>`: policy file (default `config/youtubePolicy.json`)
- `--intake-artifacts-dir <path>`: intake artifact output dir (default `artifacts/intake`)
- `--region-code <code>`: region used for restriction checks (default `US`)
- `--approve-risk`: allow soft-risk intake result if policy allows

Upload behavior options:
- `--target-channel-id <id>`: required when upload is enabled
- `--channel-profile <name>`: credential profile suffix
- `--skip-upload`: skip upload step (valid in pipeline mode only)
- `--dry-run-upload`: resolve metadata and validate channel without actual upload
- `--force-upload`: bypass duplicate protection
- `--run-artifacts-dir <path>`: run manifest output dir (default `artifacts/youtube-runs`)

Upload metadata options:
- `--metadata-file <path>`: metadata JSON file
- `--title <text>`: title override
- `--description <text>`: description override
- `--tags <csv>`: comma-separated tags
- `--category-id <id>`: YouTube category ID
- `--privacy-status <private|unlisted|public>`: default `private`
- `--default-language <code>`: default language metadata
- `--default-audio-language <code>`: default audio language metadata
- `--made-for-kids <true|false>`: set made-for-kids flag
- `--playlist-id <id>`: insert uploaded video into playlist
- `--source-title <text>`: fallback source title if no source URL
- `--source-channel-title <text>`: fallback source channel title if no source URL

### 10. Run artifacts and audit trail

For each `youtube:run`, a manifest is written to:
- `artifacts/youtube-runs/<token>_<targetLanguage>_<timestamp>.json`

Manifest includes:
- mode and source details
- intake decision/reasons (or skipped reason)
- approval fields
- upload metadata and dedupe hash
- pipeline output info when pipeline mode is used
- upload receipt (video ID/URL) or skip reason

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
- YouTube upload returns `insufficientPermissions`:
  - Recreate OAuth token with BOTH scopes:
    - `https://www.googleapis.com/auth/youtube.upload`
    - `https://www.googleapis.com/auth/youtube.readonly`
  - Then update refresh token in `.env`.
- Upload fails with channel mismatch:
  - Verify `--target-channel-id` and OAuth credentials belong to the same channel account.
  - If using `--channel-profile`, confirm `YOUTUBE_OAUTH_*_<PROFILE>` values are set correctly.
- Intake blocks everything unexpectedly:
  - Verify `config/youtubePolicy.json` has your real source channel ID(s), not the placeholder value.
