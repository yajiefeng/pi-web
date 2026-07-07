import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const {
  findBridgeRegistryForSession,
  sendBridgeCommand,
} = await import("../lib/bridge/rpc-bridge-client.ts");

const tmp = mkdtempSync(join(tmpdir(), "pi-web-bridge-routing-"));
const registryDir = join(tmp, "registry");
mkdirSync(registryDir);
const socketPath = join(tmp, "bridge.sock");
const sessionFile = join(tmp, "session.jsonl");
const token = "test-token-1234567890";
let receivedRequest;

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return;
    receivedRequest = JSON.parse(buffer.slice(0, newlineIndex));
    socket.write(JSON.stringify({
      id: receivedRequest.id,
      accepted: true,
      state: "accepted",
      command: receivedRequest.command.type,
      sessionId: "route-session",
      sessionFile,
    }) + "\n");
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, () => {
    server.off("error", reject);
    resolve();
  });
});

try {
  writeFileSync(join(registryDir, "route-session.json"), JSON.stringify({
    version: 1,
    pid: process.pid,
    socketPath,
    token,
    cwd: tmp,
    sessionId: "route-session",
    sessionFile,
    protocol: "pi-web-rpc-bridge",
    protocolVersion: 1,
    capabilities: ["prompt"],
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const registry = await findBridgeRegistryForSession({
    sessionId: "route-session",
    sessionFile,
  }, { registryDir });

  assert.ok(registry, "bridge registry should resolve for exact session id/path");
  assert.equal(registry.sessionId, "route-session");
  assert.equal(registry.sessionFile, sessionFile);
  assert.equal(registry.socketPath, socketPath);
  assert.deepEqual(registry.capabilities, ["prompt"]);

  const mismatch = await findBridgeRegistryForSession({
    sessionId: "wrong-session",
    sessionFile,
  }, { registryDir });
  assert.equal(mismatch, null, "registry lookup must reject session id mismatch");

  const response = await sendBridgeCommand(registry, {
    id: "route-command-1",
    expectedSessionId: "route-session",
    expectedSessionFile: sessionFile,
    command: { type: "prompt", message: "hello through bridge" },
  }, { timeoutMs: 5000 });

  assert.equal(response.accepted, true);
  assert.equal(response.command, "prompt");
  assert.equal(response.sessionId, "route-session");
  assert.equal(receivedRequest.token, token, "bridge client should include registry token");
  assert.equal(receivedRequest.expectedSessionId, "route-session");
  assert.equal(receivedRequest.expectedSessionFile, sessionFile);
  assert.deepEqual(receivedRequest.command, { type: "prompt", message: "hello through bridge" });

  const agentRoute = readFileSync("app/api/agent/[id]/route.ts", "utf8");
  assert.match(agentRoute, /findBridgeRegistryForSession/, "Agent route should look up bridge registry for Herdr-owned sessions");
  assert.match(agentRoute, /sendBridgeCommand/, "Agent route should send prompt commands through the bridge client");
  assert.match(agentRoute, /bridge/i, "Agent route should preserve bridge-specific error handling");
  assert.match(agentRoute, /startRpcSession\(id, filePath, cwd\)/, "Agent route should preserve pi-web-managed fallback path");
  assert.doesNotMatch(agentRoute, /agent send|pane send-text|pane send-keys|pane send-input|pane run/i,
    "Agent route must not use terminal-keystroke fallback for Herdr-owned command routing");

  console.log("Herdr bridge routing checks passed");
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
