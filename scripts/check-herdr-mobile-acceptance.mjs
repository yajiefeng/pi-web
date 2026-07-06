import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const chatInput = readFileSync("components/ChatInput.tsx", "utf8");
const mobileFontCheck = readFileSync("scripts/check-mobile-input-font-size.mjs", "utf8");
const manualAcceptance = readFileSync("docs/superpowers/specs/2026-07-06-herdr-default-new-session-mobile-acceptance.md", "utf8");

assert.match(manualAcceptance, /Do not run `npm run build`/, "manual acceptance should preserve the deployment gate");
assert.match(manualAcceptance, /mobile/i, "manual acceptance should cover mobile");
assert.match(manualAcceptance, /Pending Herdr Session/, "manual acceptance should cover pending state");
assert.match(manualAcceptance, /Waiting for Session Binding/, "manual acceptance should cover binding wait state");
assert.match(manualAcceptance, /No Session Binding appeared within 15 seconds/, "manual acceptance should cover timeout copy");
assert.match(manualAcceptance, /Focus Herdr agent/, "manual acceptance should cover focus action");
assert.match(manualAcceptance, /Try Herdr again/, "manual acceptance should cover retry action");
assert.match(manualAcceptance, /Create web session instead/, "manual acceptance should cover explicit fallback");
assert.match(manualAcceptance, /Read-only Herdr Session/, "manual acceptance should cover read-only state");
assert.match(manualAcceptance, /voice input button/, "manual acceptance should cover fallback voice input");
assert.match(manualAcceptance, /Steer/, "manual acceptance should cover fallback Steer");
assert.match(manualAcceptance, /Follow-up/, "manual acceptance should cover fallback Follow-up");
assert.match(manualAcceptance, /does not show voice input, `Send`, `Steer`, or `Follow-up`/,
  "manual acceptance should cover read-only control removal");
assert.match(manualAcceptance, /test:mobile-input-font-size/, "manual acceptance should reference the no-zoom check");

assert.match(appShell, /setPendingHerdrSession\(\{ cwd, state: "creating", startedAt \}\)/,
  "Mobile + New should still immediately enter Pending Herdr Session");
assert.match(appShell, /onCreateWebSessionInstead=\{handleCreateWebSessionInstead\}/,
  "Mobile timeout UI should have explicit fallback action wired");
assert.match(appShell, /onTryHerdrAgain=\{handleRetryPendingHerdrSession\}/,
  "Mobile timeout UI should have retry action wired");
assert.match(appShell, /readOnlyHerdrSession=\{readOnlyHerdrSession\}/,
  "Mobile selected Herdr-owned sessions should receive read-only state");

assert.match(chatWindow, /Pending Herdr Session/, "ChatWindow should render Pending Herdr Session");
assert.match(chatWindow, /No Session Binding appeared within 15 seconds/, "ChatWindow should render timeout copy");
assert.match(chatWindow, /Focus Herdr agent/, "ChatWindow should render Focus Herdr agent");
assert.match(chatWindow, /Try Herdr again/, "ChatWindow should render Try Herdr again");
assert.match(chatWindow, /Create web session instead/, "ChatWindow should render explicit fallback action");
assert.match(chatWindow, /Read-only Herdr Session/, "ChatWindow should render Read-only Herdr Session");
assert.match(chatWindow, /const composerElement = readOnlyHerdrSession \?[\s\S]*: chatInputElement/,
  "Read-only Herdr Sessions should replace normal composer while fallback sessions keep it");
assert.match(chatWindow, /flexWrap: "wrap"/, "Pending/read-only action rows should wrap on mobile");

assert.match(chatInput, /mobileStreamingActions/, "Mobile fallback composer should preserve streaming action layout");
assert.match(chatInput, /voiceInputButton/, "Mobile fallback composer should preserve voice input");
assert.match(chatInput, /Steer/, "Mobile fallback composer should preserve Steer");
assert.match(chatInput, /Follow-up/, "Mobile fallback composer should preserve Follow-up");
assert.match(mobileFontCheck, /fontSize|16px|no-zoom/i, "No-zoom mobile input check should remain present");

console.log("Herdr mobile acceptance checks passed");
