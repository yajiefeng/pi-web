import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatInput = readFileSync("components/ChatInput.tsx", "utf8");
const globals = readFileSync("app/globals.css", "utf8");

assert.match(chatInput, /readOnly=\{isVoiceBusy\}/, "ChatInput should protect the draft while voice input is busy");
assert.match(chatInput, /aria-live="polite"/, "voice status should announce recording/transcribing state");
assert.match(chatInput, /voice-input-waveform/, "recording state should render a waveform indicator");
assert.match(chatInput, /recordingElapsedSeconds/, "recording state should track elapsed time");
assert.match(chatInput, /Stop voice recording/, "recording state should expose a clear stop control");
assert.match(globals, /@keyframes voice-input-wave/, "waveform animation should be defined");
assert.match(globals, /prefers-reduced-motion/, "waveform animation should respect reduced motion");

console.log("voice input UI checks passed");
