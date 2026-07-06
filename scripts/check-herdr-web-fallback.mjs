import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const chatInput = readFileSync("components/ChatInput.tsx", "utf8");
const useAgentSession = readFileSync("hooks/useAgentSession.ts", "utf8");
const agentRoute = readFileSync("app/api/agent/[id]/route.ts", "utf8");

assert.match(appShell, /const handleCreateWebSessionInstead[\s\S]*pendingHerdrRequestIdRef\.current \+= 1[\s\S]*setPendingHerdrSession\(null\)[\s\S]*setNewSessionCwd\(cwd\)/,
  "Explicit web fallback should invalidate pending Herdr and enter the legacy new-session cwd path");
assert.match(appShell, /const effectiveNewSessionCwd = pendingHerdrSession \? null : newSessionCwd/,
  "Legacy web composer should be active only after pending Herdr state is cleared");
assert.match(appShell, /const handleSessionCreated[\s\S]*setPendingHerdrSession\(null\)[\s\S]*setSelectedSession\(session\)/,
  "Web-managed session creation should promote to the real selected session");

assert.match(chatWindow, /const composerElement = readOnlyHerdrSession \?[\s\S]*: chatInputElement/,
  "Non-read-only sessions, including explicit web fallback, should render the normal composer");
assert.match(chatWindow, /onSteer=\{agentRunning \? handleSteer : undefined\}/,
  "Web-managed running sessions should keep Steer");
assert.match(chatWindow, /onFollowUp=\{agentRunning \? handleFollowUp : undefined\}/,
  "Web-managed running sessions should keep Follow-up");
assert.match(chatWindow, /onCompact=\{session \|\| isNew \? handleCompact : undefined\}/,
  "Web-managed sessions should keep Compact");
assert.match(chatWindow, /onAbort=\{handleAbort\}/,
  "Web-managed sessions should keep Abort");

assert.match(chatInput, /useVoiceInput/, "Web-managed composer should keep voice input");
assert.match(chatInput, /voiceInputButton/, "Web-managed composer should render the voice input button");
assert.match(chatInput, /Steer/, "Web-managed composer should expose Steer when streaming");
assert.match(chatInput, /Follow-up/, "Web-managed composer should expose Follow-up when streaming");
assert.match(chatInput, /Send/, "Web-managed composer should expose Send");

assert.match(useAgentSession, /if \(isNew && newSessionCwd\)[\s\S]*fetch\("\/api\/agent\/new"/,
  "Explicit web fallback should still use the legacy /api/agent/new session creation path");
assert.match(useAgentSession, /await sendAgentCommand\(realId, \{[\s\S]*type: "prompt"/,
  "Explicit web fallback should still send prompts through the pi-web-managed command path");
assert.match(agentRoute, /if \(!status\?\.herdrAgentId\) return null/,
  "Agent command route should allow sessions that are not Herdr-owned");
assert.match(agentRoute, /startRpcSession\(id, filePath, cwd\)/,
  "Existing pi-web-managed sessions should still be able to start or resume RPC runtime");

console.log("Herdr web fallback checks passed");
