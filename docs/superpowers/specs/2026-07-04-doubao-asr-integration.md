# Doubao ASR integration for voice input

Voice input uses `POST /api/transcribe` as the only browser-facing endpoint. The browser uploads audio to pi-web; pi-web chooses the server-side transcription provider.

## Provider priority

1. Volcengine Ark / Doubao ASR
2. OpenAI transcription fallback

## Volcengine Ark / Doubao ASR

Default endpoint:

```text
https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions
```

Default model:

```text
doubao-seed-asr-2.0
```

Supported key sources:

- `ARK_API_KEY`
- `VOLCENGINE_ARK_API_KEY`
- pi auth provider `volcengine-ark`
- pi auth provider `ark`
- pi auth provider `doubao`

Optional overrides:

- `ARK_BASE_URL` or `VOLCENGINE_ARK_BASE_URL`
- `ARK_ASR_MODEL` or `VOLCENGINE_ARK_ASR_MODEL`

## OpenAI fallback

If no Ark/Doubao key is configured, pi-web falls back to OpenAI:

```text
https://api.openai.com/v1/audio/transcriptions
model=gpt-4o-mini-transcribe
```

OpenAI uses the existing `openai` provider API key.

## Privacy

The API key stays server-side. Audio is sent from the browser to pi-web and then directly to the selected transcription provider. pi-web does not persist uploaded audio.
