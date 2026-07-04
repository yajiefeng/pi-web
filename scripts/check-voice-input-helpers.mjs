import assert from "node:assert/strict";

const {
  appendVoiceTranscript,
  formatRecordingDuration,
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

assert.match(normalizeVoiceInputError({ name: "NotAllowedError" }), /microphone permission/i);
assert.match(normalizeVoiceInputError(new Error("MediaRecorder is not supported")), /not supported/i);
assert.match(normalizeVoiceInputError(new Error("OpenAI API key is not configured")), /openai api key/i);
assert.match(normalizeVoiceInputError(new Error("Transcription returned no text")), /no speech/i);
assert.match(normalizeVoiceInputError(new Error("something exploded")), /transcription failed/i);
assert.match(normalizeVoiceInputError({ code: "permission-denied" }), /microphone permission/i);

console.log("voice input helper checks passed");
