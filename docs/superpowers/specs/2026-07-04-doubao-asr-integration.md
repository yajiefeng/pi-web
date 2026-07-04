# Doubao ASR integration for voice input

Voice input uses `POST /api/transcribe` as the only browser-facing endpoint. The browser uploads audio to pi-web; pi-web chooses the server-side transcription provider. The endpoint rejects audio files larger than 10 MiB and request bodies with `Content-Length` above 11 MiB.

## Provider priority

1. Volcengine Agent Plan / Doubao ASR
2. OpenAI transcription fallback

## Volcengine Agent Plan / Doubao ASR

Default endpoint:

```text
wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream
```

Default resource id:

```text
volc.seedasr.sauc.duration
```

Supported key sources:

- `VOLCENGINE_AGENT_PLAN_API_KEY`
- `VOLCENGINE_ASR_API_KEY`
- `ARK_API_KEY`
- `VOLCENGINE_ARK_API_KEY`
- pi auth provider `volcengine-ark`
- pi auth provider `ark`
- pi auth provider `doubao`

Optional overrides:

- `VOLCENGINE_ASR_WS_URL` or `VOLCENGINE_AGENT_PLAN_ASR_WS_URL`
- `VOLCENGINE_ASR_RESOURCE_ID` or `VOLCENGINE_AGENT_PLAN_ASR_RESOURCE_ID`
- `VOLCENGINE_ASR_SEGMENT_DURATION_MS`
- `VOLCENGINE_ASR_SEGMENT_DELAY_MS`
- `VOLCENGINE_ASR_TIMEOUT_MS`

The saved `volcengine-ark` provider id is retained for compatibility with the
existing API key settings UI, but the key must be the Agent Plan dedicated API
key. A standard Ark key can list Ark models while still failing ASR with a 401.

## OpenAI fallback

If no Ark/Doubao key is configured, pi-web falls back to OpenAI:

```text
https://api.openai.com/v1/audio/transcriptions
model=gpt-4o-mini-transcribe
```

OpenAI uses the existing `openai` provider API key.

## Privacy

The API key stays server-side. Audio is sent from the browser to pi-web and then directly to the selected transcription provider. pi-web does not persist uploaded audio.

## Browser recording note

`MediaRecorder` is the primary browser recording path. The Web Audio PCM/WAV recorder exists only as a compatibility fallback for browsers where `MediaRecorder` is unavailable or unusable.
