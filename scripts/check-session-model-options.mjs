import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "pi-web-session-model-options-"));
const registryDir = join(tmp, "registry");
const socketPath = join(tmp, "bridge.sock");
const sessionId = "older-runtime-session";
const token = "session-model-options-token";
let rejectRuntimeCatalog = false;
mkdirSync(registryDir);

const runtimeModel = {
  id: "runtime-supported-model",
  name: "Runtime Supported Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return;
    const request = JSON.parse(buffer.slice(0, newlineIndex));
    assert.equal(request.command.type, "get_available_models");
    socket.write(JSON.stringify(rejectRuntimeCatalog
      ? {
          id: request.id,
          accepted: false,
          command: "get_available_models",
          sessionId,
          errorCode: "pi_rpc_error",
          errorMessage: "runtime catalog unavailable",
        }
      : {
          id: request.id,
          accepted: true,
          command: "get_available_models",
          sessionId,
          data: { models: [runtimeModel] },
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
  writeFileSync(join(registryDir, `${sessionId}.json`), JSON.stringify({
    version: 1,
    pid: process.pid,
    socketPath,
    token,
    cwd: tmp,
    sessionId,
    protocol: "pi-web-rpc-bridge",
    protocolVersion: 2,
    capabilities: ["get_available_models", "set_model"],
    updatedAt: new Date().toISOString(),
  }));

  process.env.PI_WEB_RPC_BRIDGE_REGISTRY_DIR = registryDir;
  const { GET } = await import(`../app/api/models/route.ts?test=${Date.now()}`);
  const response = await GET(new Request(
    `http://localhost/api/models?cwd=${encodeURIComponent(tmp)}&sessionId=${sessionId}`,
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.modelList,
    [{ id: runtimeModel.id, name: runtimeModel.name, provider: runtimeModel.provider }],
    "An existing session must list models from its owning runtime, not from the web server's newer registry",
  );

  rejectRuntimeCatalog = true;
  const failedResponse = await GET(new Request(
    `http://localhost/api/models?cwd=${encodeURIComponent(tmp)}&sessionId=${sessionId}`,
  ));
  const failedBody = await failedResponse.json();
  assert.equal(failedResponse.status, 502, "Runtime catalog failures must not fall back to a mismatched server catalog");
  assert.match(failedBody.error, /runtime catalog unavailable/);

  const hook = readFileSync("hooks/useAgentSession.ts", "utf8");
  assert.match(hook, /params\.set\("sessionId", session\.id\)/,
    "Existing sessions should identify themselves when loading model options");
  assert.match(hook, /setModelList\(\[\]\)[\s\S]*fetch\(modelsUrl/,
    "A session change should clear stale model options before loading its runtime catalog");
  assert.match(hook, /Failed to load session models/,
    "Runtime model catalog failures should be shown to the user");
  assert.match(hook, /Failed to switch model/,
    "Model switch failures should be shown to the user");
  assert.match(hook, /addNotice\(\{\s*type: "error"/s,
    "Model switch failures should use the visible notice UI");

  console.log("Session runtime model option checks passed");
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
