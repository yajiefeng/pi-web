import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const sessionSidebar = readFileSync("components/SessionSidebar.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");

assert.match(appShell, /type PendingHerdrSession/, "AppShell should model a Pending Herdr Session explicitly");
assert.match(appShell, /pendingHerdrSession/, "AppShell should own pending Herdr session state");
assert.match(appShell, /fetch\("\/api\/runtime\/herdr\/agents"/, "+ New should start Herdr agent creation by default");
assert.match(appShell, /setPendingHerdrSession\(\{\s*cwd,\s*state: "creating"/s, "+ New should immediately enter a creating pending state");
assert.match(appShell, /const agentLabel = data\.agentLabel[\s\S]*agentLabel,/,
  "Herdr creation result should store the returned agent label");
assert.match(appShell, /pendingHerdrSession=\{pendingHerdrSession\}/, "ChatWindow should receive pending Herdr state");
assert.match(appShell, /selectedSession\?\.cwd \?\? pendingHerdrSession\?\.cwd \?\? newSessionCwd/, "Sidebar cwd selection should be preserved while pending");
assert.match(appShell, /pendingHerdrSession \? null : newSessionCwd/, "Pending Herdr state should suppress the legacy new-session composer");

assert.doesNotMatch(sessionSidebar, /crypto\.randomUUID/, "Sidebar should no longer create fake client-side session ids for + New");
assert.match(sessionSidebar, /onNewSession\?\.\(selectedCwd\)/, "Sidebar should invoke + New with the selected cwd");

assert.match(chatWindow, /pendingHerdrSession/, "ChatWindow should accept pending Herdr state");
assert.match(chatWindow, /Pending Herdr Session/, "Pending state should be visible to the user");
assert.match(chatWindow, /Waiting for Session Binding/, "Pending state should explain what pi-web is waiting for");
assert.match(chatWindow, /pendingHerdrSession\.agentLabel/, "Pending state should show the Herdr agent label when returned");
assert.match(chatWindow, /Starting Herdr agent/, "Pending state should communicate Herdr agent creation has started");

console.log("Herdr pending UI checks passed");
