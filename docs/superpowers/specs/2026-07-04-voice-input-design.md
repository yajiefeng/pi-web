# Voice Input Design

## Summary

Add first-class voice input to pi-web so a user can dictate a prompt on mobile, have it transcribed on the server, and review the resulting text before sending it to the agent.

First version behavior:

1. User taps a microphone button in `ChatInput`.
2. Browser records audio with `MediaRecorder`, falling back to Web Audio PCM/WAV only when `MediaRecorder` is unavailable or unusable.
3. User taps stop, or recording auto-stops after 60 seconds.
4. Browser uploads the audio blob to pi-web.
5. Server transcribes with Volcengine Ark / Doubao ASR first, falling back to OpenAI transcription when no Ark/Doubao key is configured.
6. Transcribed text is appended to the current input draft.
7. User reviews/edits and manually sends.

## Goals

- Make voice input comfortable on iPhone Chrome.
- Keep the existing text-send flow unchanged.
- Do not auto-send transcribed text.
- Do not expose API keys to the browser.
- Do not persist audio files.
- Provide clear, recoverable errors without losing the user's draft.

## Non-Goals

- No live speech-to-text streaming in the first version.
- No browser Web Speech API fallback in the first version.
- No auto-send after transcription.
- No language selector in the first version.
- No real audio frequency visualization in the first version.
- No support for routing voice directly to Herdr agents; voice input only produces text in the existing chat input.

## Product Decisions

### Interaction Model

Use **tap-to-toggle recording**:

- Tap microphone to start recording.
- Tap stop to end recording and begin transcription.
- Automatically stop and transcribe at 60 seconds.

This avoids long-press friction on mobile and lets users dictate longer prompts comfortably.

### Placement

Place the microphone button in `ChatInput`, near the send button. Voice is another input method, so it belongs next to the existing text input and send action.

### Result Handling

Transcription output is appended to the current input draft:

- Empty draft: insert the transcript directly.
- Non-empty draft: append the transcript to the end with sensible spacing.
- Never overwrite existing input.
- Never send automatically.

### Recording UI

While recording, the input area becomes read-only and displays:

- A lightweight waveform animation.
- Elapsed recording time, for example `0:06`.
- A stop-square button.

While transcribing, show `Transcribing…` and keep the input read-only. After success or failure, restore editing.

The waveform can be CSS/React-driven pseudo animation. It does not need to reflect real audio amplitude in the first version.

### Browser Support

Mobile-first, but not mobile-only:

- Enable the microphone button when `navigator.mediaDevices.getUserMedia` is available and either `MediaRecorder` or Web Audio recording is available.
- Disable or hide it when unsupported.
- Primary manual acceptance target: iPhone Chrome.

### Language

Use the selected transcription provider's automatic language detection. Do not pass a fixed `language` parameter in the first version.

## Architecture

### Client

`ChatInput` consumes voice input through `hooks/useVoiceInput.ts`. The hook owns the browser recording state and returns the small interface the composer needs: support status, busy status, recording/transcribing status, current error, diagnostics text, display status, and start/stop/toggle actions.

`components/voice-input-recorder.ts` owns the browser/media details:

- Request microphone permission.
- Start and stop browser recording.
- Accumulate audio chunks in `MediaRecorder` or the Web Audio fallback.
- Upload the audio blob as multipart form data.

`hooks/useVoiceInput.ts` owns composer-level voice workflow:

- `idle`
- `recording`
- `transcribing`
- `error`
- Enforce the 60-second max duration.
- Append returned text to the draft through an `onTranscript` callback.
- Surface short error messages and browser diagnostics.

### Server

Add a transcription endpoint:

```text
POST /api/transcribe
```

Request:

```text
multipart/form-data
audio: audio blob
```

Successful response:

```json
{ "text": "transcribed prompt text" }
```

Error response:

```json
{ "error": "Configure transcription API key" }
```

Server responsibilities:

- Validate that a file is present.
- Enforce a conservative upload size limit: 10 MiB for the audio file, with an 11 MiB request `Content-Length` pre-check.
- Resolve the server-side transcription provider from environment variables or pi-web auth storage.
- Call the selected transcription provider.
- Return only the transcript text.
- Avoid writing uploaded audio to disk.

### Provider Choice

Current provider priority:

1. Volcengine Ark / Doubao ASR (`doubao-seed-asr-2.0` by default).
2. OpenAI transcription fallback (`gpt-4o-mini-transcribe` by default).

Keep transcription model selection separate from the selected chat model so voice input does not affect agent model selection.

### API Key Handling

Volcengine Ark / Doubao ASR keys can come from environment variables or the `volcengine-ark`, `ark`, or `doubao` pi auth providers. OpenAI fallback uses the existing `openai` provider API key.

If no transcription provider key is configured:

- The server returns a clear configuration error.
- The client shows a short message such as `Configure transcription API key`.
- The existing draft remains untouched.

## Error Handling

Client-facing errors should be short and recoverable:

| Case | Message |
| --- | --- |
| Browser lacks recording APIs | `Voice input is not supported in this browser` |
| Microphone permission denied | `Microphone permission denied` |
| Transcription provider key missing | `Configure transcription API key` |
| Empty or too-short audio | `No speech detected` |
| Upload/network/transcription failure | `Transcription failed. Try again.` |

Errors must not clear the current input draft.

## Data And Privacy

- Audio is held in browser memory until upload.
- Server processes the multipart upload in memory for the transcription request.
- Audio is not saved to the repository, pi session files, logs, or temporary files.
- API key remains server-side.
- Transcript text only enters the session if the user manually sends it.

## Testing Strategy

### Unit / Logic Tests

Add tests for client helpers where practical:

- Transcript append behavior for empty and non-empty drafts.
- Error normalization.
- Recording duration formatting.

### API Tests / Smoke Checks

Add a lightweight test script or route-level check for:

- Missing file returns a 400.
- Missing transcription provider key returns a configuration error.
- Oversized audio upload returns a 413.
- Unsupported/empty audio maps to `No speech detected` where detectable.

Avoid requiring a real OpenAI API call in normal test runs. Keep real-provider testing manual or gated by environment variables.

### Manual Acceptance

On iPhone Chrome:

1. Open pi-web.
2. Tap microphone in `ChatInput`.
3. Grant microphone permission.
4. Speak a short prompt.
5. Tap stop.
6. Confirm waveform/recording UI changes to `Transcribing…`.
7. Confirm transcript is appended to the input box.
8. Edit the transcript.
9. Send manually.
10. Confirm normal chat flow still works.

Also test:

- Existing draft is preserved after transcription failure.
- Recording auto-stops at 60 seconds.
- Unsupported browsers do not show a broken microphone action.

## Rollout Plan

1. Implement the server transcription endpoint.
2. Implement the recording hook/state machine in `ChatInput`.
3. Add the microphone button and recording/transcribing UI.
4. Add regression tests and smoke checks.
5. Verify on desktop browser with a short recording.
6. Deploy only after explicit approval.
7. Manually verify on iPhone Chrome.

## Open Questions For Later Versions

- Should language selection be added for users who mostly dictate in one language?
- Should real audio amplitude visualization replace the pseudo waveform?
- Should Herdr-managed sessions receive voice text through a Herdr message route once Herdr becomes the default runtime?
