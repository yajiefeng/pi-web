import assert from "node:assert/strict";

const {
  appendVoiceTranscript,
  formatRecordingDuration,
  getVoiceInputStatus,
  normalizeVoiceInputError,
} = await import("../components/voice-input-helpers.ts");

assert.equal(appendVoiceTranscript("", "hello from voice"), "hello from voice");
assert.equal(appendVoiceTranscript("   ", "hello from voice"), "hello from voice");
assert.equal(appendVoiceTranscript("Existing draft", "spoken follow-up"), "Existing draft spoken follow-up");
assert.equal(appendVoiceTranscript("Existing draft", "   \n  "), "Existing draft");
assert.equal(appendVoiceTranscript("Existing draft ", " spoken follow-up "), "Existing draft spoken follow-up");
assert.equal(appendVoiceTranscript("Existing draft", ", with punctuation"), "Existing draft, with punctuation");

assert.equal(formatRecordingDuration(0), "0:00");
assert.equal(formatRecordingDuration(5), "0:05");
assert.equal(formatRecordingDuration(65), "1:05");

assert.deepEqual(getVoiceInputStatus({ phase: "recording", elapsedSeconds: 5 }), {
  label: "Recording",
  detail: "0:05",
  ariaLabel: "Recording voice for 0:05. Tap stop when done.",
});
assert.deepEqual(getVoiceInputStatus({ phase: "transcribing", elapsedSeconds: 0 }), {
  label: "Transcribing",
  detail: "Please wait…",
  ariaLabel: "Transcribing voice input.",
});
assert.equal(getVoiceInputStatus({ phase: "idle", elapsedSeconds: 0 }), null);

assert.match(normalizeVoiceInputError({ name: "NotAllowedError" }), /microphone permission/i);
assert.match(normalizeVoiceInputError(new Error("MediaRecorder is not supported")), /not supported/i);
assert.match(normalizeVoiceInputError(new Error("OpenAI API key is not configured")), /openai api key/i);
assert.match(normalizeVoiceInputError(new Error("Transcription returned no text")), /no speech/i);
assert.match(normalizeVoiceInputError(new Error("something exploded")), /transcription failed/i);
assert.match(normalizeVoiceInputError({ code: "permission-denied" }), /microphone permission/i);

console.log("voice input helper checks passed");
