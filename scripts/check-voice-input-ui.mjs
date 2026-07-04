import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatInput = readFileSync("components/ChatInput.tsx", "utf8");
const useVoiceInputHook = readFileSync("hooks/useVoiceInput.ts", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const manualAcceptance = readFileSync("docs/superpowers/specs/2026-07-04-voice-input-manual-acceptance.md", "utf8");

assert.match(chatInput, /readOnly=\{isVoiceBusy\}/, "ChatInput should protect the draft while voice input is busy");
assert.match(chatInput, /aria-live="polite"/, "voice status should announce recording/transcribing state");
assert.match(chatInput, /voice-input-waveform/, "recording state should render a waveform indicator");
assert.doesNotMatch(chatInput, /audioInputRef/, "voice input should record inline, not choose audio files");
assert.doesNotMatch(chatInput, /Choose audio/, "voice input should not offer file selection as the primary fallback");
assert.match(chatInput, /useVoiceInput/, "ChatInput should consume voice input through the useVoiceInput hook");
assert.doesNotMatch(chatInput, /startVoiceRecording|supportsVoiceInput|getVoiceInputDiagnostics|voiceRecordingRef|recordingElapsedSeconds/, "ChatInput should not own browser recording internals");
assert.match(useVoiceInputHook, /recordingElapsedSeconds/, "voice hook should track elapsed recording time");
assert.match(useVoiceInputHook, /shouldAutoStopRecording/, "voice hook should auto-stop at the configured limit");
assert.match(useVoiceInputHook, /startVoiceRecording/, "voice hook should own browser recording startup");
assert.match(useVoiceInputHook, /getVoiceInputDiagnostics/, "voice hook should own browser diagnostics");
assert.match(chatInput, /Stop voice recording/, "recording state should expose a clear stop control");
assert.match(chatInput, /const voiceInputButton[\s\S]*handleVoiceInputClick/, "voice input button should use the shared voice click handler");
assert.match(chatInput, /isStreaming \? \([\s\S]*\{voiceInputButton\}[\s\S]*Steer[\s\S]*Follow-up/, "streaming controls should include the same voice input button next to Steer and Follow-up");
assert.match(chatInput, /mobileStreamingActions/, "mobile streaming composer should detect when action buttons are present");
assert.match(chatInput, /flexWrap: shouldWrapComposerControls \? "wrap" : "nowrap"/, "mobile streaming composer should wrap controls below the textarea");
assert.match(chatInput, /width: mobileStreamingActions \? "100%" : undefined/, "mobile streaming controls should take a full-width row");
assert.match(chatInput, /justifyContent: mobileStreamingActions \? "flex-end" : undefined/, "mobile streaming controls should right-align below the textarea");
assert.match(chatInput, /Try again/, "voice failures should expose a retry path");
assert.match(chatInput, /Voice diagnostics/, "voice failures should expose browser microphone diagnostics");
assert.match(useVoiceInputHook, /policy=/, "voice diagnostics should expose the microphone permission policy state");
assert.match(globals, /@keyframes voice-input-wave/, "waveform animation should be defined");
assert.match(globals, /prefers-reduced-motion/, "waveform animation should respect reduced motion");
assert.match(manualAcceptance, /iPhone Chrome/, "manual acceptance should cover iPhone Chrome");
assert.match(manualAcceptance, /desktop browser/i, "manual acceptance should cover desktop smoke testing");
assert.match(manualAcceptance, /Do not run `npm run build`/, "manual acceptance should preserve the deployment gate");

console.log("voice input UI checks passed");
