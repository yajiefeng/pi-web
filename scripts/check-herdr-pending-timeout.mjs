import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");

assert.match(appShell, /PENDING_HERDR_TIMEOUT_MS = 15_000/, "Pending Herdr timeout should be exactly 15 seconds");
assert.match(appShell, /state: "timed_out"/, "Pending Herdr Session should have an explicit timed_out state");
assert.match(appShell, /setTimeout\([\s\S]*PENDING_HERDR_TIMEOUT_MS/, "Pending timeout should be timer-driven");
assert.match(appShell, /pendingHerdrRequestIdRef\.current \+= 1/, "Explicit fallback should invalidate late Herdr creation responses");
assert.match(appShell, /const handleRetryPendingHerdrSession[\s\S]*handleNewSession\(pendingHerdrSession\.cwd\)/,
  "Try Herdr again should start a new Herdr creation attempt for the same cwd");
assert.match(appShell, /const handleCreateWebSessionInstead[\s\S]*setPendingHerdrSession\(null\)[\s\S]*setNewSessionCwd\(cwd\)/,
  "Create web session instead should enter the legacy pi-web-managed new-session path only explicitly");
assert.match(appShell, /const handleFocusPendingHerdrAgent[\s\S]*fetch\("\/api\/runtime\/herdr\/focus"/,
  "Focus Herdr agent should call the existing focus route");
assert.match(appShell, /onTryHerdrAgain=\{handleRetryPendingHerdrSession\}/,
  "Pending UI should receive the retry action");
assert.match(appShell, /onCreateWebSessionInstead=\{handleCreateWebSessionInstead\}/,
  "Pending UI should receive the explicit web fallback action");

assert.match(chatWindow, /Focus Herdr agent/, "Timed-out pending UI should show Focus Herdr agent when available");
assert.match(chatWindow, /Try Herdr again/, "Timed-out pending UI should show retry action");
assert.match(chatWindow, /Create web session instead/, "Timed-out pending UI should show explicit web fallback");
assert.match(chatWindow, /No Session Binding appeared within 15 seconds/, "Timeout copy should explain the 15s binding timeout");
assert.doesNotMatch(appShell + chatWindow, /herdr\/(close|stop)|agent\/(close|stop)|herdr_stop/i,
  "Timeout handling must not automatically close Herdr panes");

console.log("Herdr pending timeout checks passed");
