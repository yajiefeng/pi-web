import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const tmp = mkdtempSync(join(tmpdir(), "pi-web-rpc-bridge-"));
const socketDir = join(tmp, "sockets");
const registryDir = join(tmp, "registry");
const fakePi = join(tmp, "fake-pi-rpc.mjs");
const fakeLog = join(tmp, "fake-pi-commands.jsonl");

writeFileSync(fakePi, `
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const sessionId = "bridge-test-session";
const sessionFile = "${join(tmp, "bridge-test-session.jsonl").replaceAll("\\", "\\\\")}";
const logPath = process.env.FAKE_PI_LOG;
const rl = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

rl.on("line", (line) => {
  const command = JSON.parse(line);
  if (logPath) appendFileSync(logPath, JSON.stringify(command) + "\\n");

  if (command.type === "get_state") {
    send({
      id: command.id,
      type: "response",
      command: "get_state",
      success: true,
      data: {
        sessionId,
        sessionFile,
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: "off",
        steeringMode: "all",
        followUpMode: "all",
        autoCompactionEnabled: true,
        messageCount: 0,
        pendingMessageCount: 0
      }
    });
    return;
  }

  if (["prompt", "steer", "follow_up", "abort", "set_model", "set_thinking_level", "set_auto_compaction", "set_auto_retry", "extension_ui_response"].includes(command.type)) {
    send({ id: command.id, type: "response", command: command.type, success: true });
    if (command.type === "prompt") {
      send({ type: "agent_start" });
      send({ type: "extension_ui_request", id: "ui-1", method: "notify", message: "hello", notifyType: "info" });
      setTimeout(() => send({ type: "agent_end", messages: [] }), 10);
    }
    return;
  }

  if (command.type === "compact") {
    send({ id: command.id, type: "response", command: "compact", success: true, data: { tokensBefore: 100, estimatedTokensAfter: 25 } });
    return;
  }

  if (command.type === "get_commands") {
    send({ id: command.id, type: "response", command: "get_commands", success: true, data: { commands: [{ name: "hello", source: "extension" }] } });
    return;
  }

  send({ id: command.id, type: "response", command: command.type, success: false, error: "unsupported" });
});
`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description, fn, timeoutMs = 5000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

function sendBridgeRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      resolve(JSON.parse(line));
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("Timed out waiting for bridge response"));
    });
  });
}

function subscribeBridge(socketPath, request, onEvent) {
  const socket = net.createConnection(socketPath);
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  });
  return socket;
}

const bridge = spawn(process.execPath, [
  "bin/pi-web-rpc-bridge.js",
  "--socket-dir", socketDir,
  "--registry-dir", registryDir,
  "--no-herdr-report",
  "--",
  process.execPath,
  fakePi,
], {
  cwd: process.cwd(),
  env: { ...process.env, FAKE_PI_LOG: fakeLog },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let bridgeExited = false;
bridge.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
bridge.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
bridge.on("exit", () => { bridgeExited = true; });

try {
  const registryPath = await waitFor("bridge registry", () => {
    const files = readdirSync(registryDir);
    assert.equal(files.length, 1);
    return join(registryDir, files[0]);
  });

  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.version, 1);
  assert.equal(registry.protocolVersion, 2);
  assert.equal(registry.sessionId, "bridge-test-session");
  assert.match(registry.sessionFile, /bridge-test-session\.jsonl$/);
  assert.equal(typeof registry.socketPath, "string");
  assert.equal(typeof registry.token, "string");
  assert.ok(registry.token.length >= 16, "bridge token should be non-trivial");
  assert.equal(registry.pid, bridge.pid);
  for (const capability of ["prompt", "steer", "follow_up", "abort", "compact", "get_state", "get_commands"]) {
    assert.ok(registry.capabilities.includes(capability), `bridge should advertise ${capability}`);
  }

  const subscriptionEvents = [];
  const subscription = subscribeBridge(registry.socketPath, {
    id: "sub-1",
    token: registry.token,
    expectedSessionId: registry.sessionId,
    expectedSessionFile: registry.sessionFile,
    command: { type: "subscribe" },
  }, (event) => subscriptionEvents.push(event));

  const accepted = await sendBridgeRequest(registry.socketPath, {
    id: "client-1",
    token: registry.token,
    expectedSessionId: registry.sessionId,
    expectedSessionFile: registry.sessionFile,
    command: { type: "prompt", message: "hello from pi-web", streamingBehavior: "steer" },
  });

  assert.equal(accepted.id, "client-1");
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.command, "prompt");
  assert.equal(accepted.sessionId, registry.sessionId);
  assert.equal(accepted.sessionFile, registry.sessionFile);

  for (const type of ["steer", "follow_up", "abort", "set_model", "set_thinking_level", "set_auto_compaction", "set_auto_retry", "extension_ui_response"]) {
    const response = await sendBridgeRequest(registry.socketPath, {
      id: `client-${type}`,
      token: registry.token,
      expectedSessionId: registry.sessionId,
      expectedSessionFile: registry.sessionFile,
      command: type === "steer" || type === "follow_up"
        ? { type, message: `${type} message` }
        : type === "set_model"
          ? { type, provider: "openai", modelId: "test-model" }
          : type === "set_thinking_level"
            ? { type, level: "medium" }
            : type === "set_auto_compaction" || type === "set_auto_retry"
              ? { type, enabled: false }
              : type === "extension_ui_response"
                ? { type, id: "ui-1", confirmed: true }
                : { type },
    });
    assert.equal(response.accepted, true, `${type} should be accepted`);
  }

  const compact = await sendBridgeRequest(registry.socketPath, {
    id: "client-compact",
    token: registry.token,
    expectedSessionId: registry.sessionId,
    expectedSessionFile: registry.sessionFile,
    command: { type: "compact", customInstructions: "short" },
  });
  assert.equal(compact.accepted, true);
  assert.deepEqual(compact.data, { tokensBefore: 100, estimatedTokensAfter: 25 });

  const commands = await sendBridgeRequest(registry.socketPath, {
    id: "client-get-commands",
    token: registry.token,
    expectedSessionId: registry.sessionId,
    expectedSessionFile: registry.sessionFile,
    command: { type: "get_commands" },
  });
  assert.equal(commands.accepted, true);
  assert.deepEqual(commands.data, { commands: [{ name: "hello", source: "extension" }] });

  await waitFor("forwarded extension UI event", () => subscriptionEvents.find((event) => event.type === "extension_ui_request"));
  assert.ok(subscriptionEvents.some((event) => event.type === "agent_start"), "subscription should receive Pi RPC events");
  assert.ok(subscriptionEvents.some((event) => event.type === "extension_ui_request" && event.method === "notify"), "subscription should forward extension UI requests");
  subscription.end();

  const mismatch = await sendBridgeRequest(registry.socketPath, {
    id: "client-2",
    token: registry.token,
    expectedSessionId: "wrong-session",
    expectedSessionFile: registry.sessionFile,
    command: { type: "prompt", message: "must not forward" },
  });

  assert.equal(mismatch.id, "client-2");
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.errorCode, "session_mismatch");

  const fakeCommands = readFileSync(fakeLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(fakeCommands.some((command) => command.type === "get_state"), "bridge should query Pi RPC state");
  assert.equal(
    fakeCommands.filter((command) => command.type === "prompt").length,
    1,
    "session-mismatched command must not be forwarded to Pi RPC",
  );
  assert.equal(fakeCommands.find((command) => command.type === "prompt")?.message, "hello from pi-web");
  assert.equal(fakeCommands.find((command) => command.type === "prompt")?.streamingBehavior, "steer");
  assert.ok(fakeCommands.some((command) => command.type === "steer"), "steer should forward to Pi RPC");
  assert.ok(fakeCommands.some((command) => command.type === "follow_up"), "follow_up should forward to Pi RPC");
  assert.ok(fakeCommands.some((command) => command.type === "abort"), "abort should forward to Pi RPC");
  assert.ok(fakeCommands.some((command) => command.type === "compact"), "compact should forward to Pi RPC");
  assert.ok(fakeCommands.some((command) => command.type === "get_commands"), "get_commands should forward to Pi RPC");
  assert.ok(fakeCommands.some((command) => command.type === "extension_ui_response"), "extension UI responses should forward to Pi RPC");

  console.log("Pi web RPC bridge checks passed");
} catch (error) {
  console.error("Bridge stdout:\n" + stdout);
  console.error("Bridge stderr:\n" + stderr);
  throw error;
} finally {
  if (!bridgeExited) {
    bridge.kill("SIGTERM");
    await new Promise((resolve) => bridge.once("exit", resolve));
  }
  rmSync(tmp, { recursive: true, force: true });
}
