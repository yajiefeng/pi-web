# Voice input manual acceptance checklist

Before deploying voice input, run these checks manually. Do not deploy, build, or restart production unless the user explicitly approves deployment.

## iPhone Chrome

- [ ] Open pi-web in iPhone Chrome.
- [ ] Confirm the microphone action is visible in the chat composer.
- [ ] Tap the microphone action and accept the browser microphone permission prompt.
- [ ] Confirm the composer shows the recording state, active stop control, animated waveform, and elapsed timer.
- [ ] Speak a short prompt and tap stop.
- [ ] Confirm the composer shows the transcribing state while processing.
- [ ] Confirm the transcript is appended to the existing draft and is not sent automatically.
- [ ] Edit the transcript before sending.
- [ ] Send the edited prompt and confirm normal send behavior still works.
- [ ] Deny microphone permission once and confirm the recovery error is clear.
- [ ] Temporarily remove or invalidate the OpenAI key and confirm the setup error is clear.
- [ ] Try a silent/empty recording and confirm no blank text is inserted.
- [ ] Simulate a network/transcription failure and confirm the existing draft is preserved and retry is available.

## Desktop supported-browser smoke test

- [ ] Open pi-web in a desktop browser with `navigator.mediaDevices.getUserMedia` and `MediaRecorder` support.
- [ ] Confirm the microphone action is visible.
- [ ] Start and stop a recording.
- [ ] Confirm transcription appends to the draft without auto-sending.
- [ ] Confirm normal typing and sending still work after using voice input.

## Unsupported browser behavior

- [ ] In a browser/session without `getUserMedia` or `MediaRecorder`, confirm no broken microphone action is shown.

## Deployment gate

- [ ] Do not run `npm run build`.
- [ ] Do not restart production services.
- [ ] Deploy only after explicit user approval.
