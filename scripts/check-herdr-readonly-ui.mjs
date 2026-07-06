import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const agentRoute = readFileSync("app/api/agent/[id]/route.ts", "utf8");

assert.match(appShell, /runtimeSnapshot/, "AppShell should keep runtime status for selected-session ownership");
assert.match(appShell, /selectedSessionRuntimeStatus/, "Selected session runtime status should be derived explicitly");
assert.match(appShell, /readOnlyHerdrSession/, "AppShell should model Read-only Herdr Session state");
assert.match(appShell, /selectedSessionRuntimeStatus\?\.herdrAgentId/,
  "Read-only detection should come from Herdr ownership metadata, not cwd");
assert.match(appShell, /readOnlyHerdrSession=\{readOnlyHerdrSession\}/,
  "ChatWindow should receive Read-only Herdr Session state");
assert.match(appShell, /onFocusReadOnlyHerdrAgent=\{handleFocusReadOnlyHerdrAgent\}/,
  "Read-only UI should receive a Focus Herdr agent action");
assert.doesNotMatch(appShell, /selectedSession\?\.cwd === .*herdr/i,
  "Read-only detection must not infer ownership from cwd");

assert.match(chatWindow, /Read-only Herdr Session/, "Read-only state should be visible to the user");
assert.match(chatWindow, /Herdr-owned/, "Read-only copy should explain Herdr ownership");
assert.match(chatWindow, /web command routing is not available yet/, "Read-only copy should explain why composer is disabled");
assert.match(chatWindow, /Send messages from the Herdr pane/, "Read-only copy should tell the user where to send messages");
assert.match(chatWindow, /Focus Herdr agent/, "Read-only UI should expose Focus Herdr agent");
assert.match(chatWindow, /const composerElement = readOnlyHerdrSession \?/,
  "Read-only Herdr Sessions should replace the normal composer");
assert.match(chatWindow, /onFork=\{readOnlyHerdrSession \? undefined :/,
  "Read-only Herdr Sessions should not expose fork commands");
assert.match(chatWindow, /onNavigate=\{readOnlyHerdrSession \? undefined :/,
  "Read-only Herdr Sessions should not expose navigation commands");

assert.match(agentRoute, /getRuntimeStatusSnapshot/, "Agent command route should check runtime ownership before starting RPC");
assert.match(agentRoute, /herdrAgentId/, "Agent command route should detect Herdr-owned sessions");
assert.match(agentRoute, /status: 409/, "Agent command route should reject Herdr-owned session commands with 409");
assert.match(agentRoute, /read-only in pi-web/, "Agent command route error should explain read-only behavior");

console.log("Herdr read-only UI checks passed");
