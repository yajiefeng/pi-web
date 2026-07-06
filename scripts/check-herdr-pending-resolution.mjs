import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync("components/AppShell.tsx", "utf8");

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
