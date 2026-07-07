import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const runtimeMerge = readFileSync("lib/runtime-status/merge.ts", "utf8");
const sessionBinding = readFileSync("lib/runtime-status/session-binding.ts", "utf8");
const sessionsRoute = readFileSync("app/api/sessions/route.ts", "utf8");
const sessionRoute = readFileSync("app/api/sessions/[id]/route.ts", "utf8");

assert.match(appShell, /RuntimeStatusSnapshot/, "AppShell should read runtime status snapshots while Herdr binding is pending");
assert.match(appShell, /new EventSource\("\/api\/runtime\/status\/events"\)/,
  "Pending Herdr Session should watch runtime-status SSE");
assert.match(appShell, /fetch\("\/api\/runtime\/status"\)/,
  "Pending Herdr Session should check the current runtime-status snapshot before waiting for SSE");
assert.match(appShell, /snapshot\.herdrAgents\.find\(\(agent\) => agent\.id === pendingHerdrSession\.agentId\)/,
  "Pending resolution must watch the exact Herdr agent id returned by creation");
assert.match(appShell, /agent\.sessionId \?\? Object\.values\(snapshot\.sessions\)\.find\(\(status\) => status\.herdrAgentId === agent\.id\)\?\.sessionId/s,
  "Pending resolution should support direct session id and session-path mapping through runtime status");
assert.match(appShell, /fetch\("\/api\/sessions"\)/,
  "Opening a bound Herdr Session should refresh the session list before selecting it");
assert.match(sessionBinding, /inferSessionIdFromSessionPath/, "Path-only Herdr bindings should infer session id from the exact session file path");
assert.match(runtimeMerge, /inferSessionIdFromSessionPath\(agent\.sessionPath\)/,
  "Runtime status should include path-only Herdr sessions before they appear in the session list");
assert.match(sessionsRoute, /listBridgeRegistries/, "Session list should include live bridge registry placeholders");
assert.match(sessionRoute, /findBridgeRegistryForSession/, "Single-session API should serve empty bridge sessions before their JSONL is written");
assert.match(sessionRoute, /messageCount: 0/, "Empty bridge session placeholder should be explicit and non-mutating");
assert.match(appShell, /setPendingHerdrSession\(null\)[\s\S]*setSelectedSession\(session\)/,
  "Successful binding should clear pending state and open the linked session");
assert.match(appShell, /router\.replace\(`\?session=\$\{encodeURIComponent\(session\.id\)\}`/,
  "Successful binding should update the URL to the linked session id");
assert.doesNotMatch(appShell, /agent\.cwd === pendingHerdrSession\.cwd/,
  "Pending resolution must not infer a binding from cwd");
const resolverBlock = appShell.slice(appShell.indexOf("const resolveSnapshot"), appShell.indexOf("const handleSessionCreated"));
assert.doesNotMatch(resolverBlock, /cwd|latest|modified|timestamp/i,
  "Pending resolution must not infer a binding from cwd/latest/timestamp heuristics");

console.log("Herdr pending resolution checks passed");
