import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

const bridgeSource = readFileSync("bin/pi-web-rpc-bridge.js", "utf8");
assert.match(bridgeSource, /COMPACT_RPC_TIMEOUT_MS/, "Bridge should allow long-running Pi RPC compaction");
assert.match(bridgeSource, /rpcTimeoutForCommand\(rpcPayload\.type\)/, "Bridge should use command-specific Pi RPC timeouts");

const tmp = mkdtempSync(join(tmpdir(), "pi-web-rpc-bridge-"));
const socketDir = join(tmp, "sockets");
const registryDir = join(tmp, "registry");
const fakePi = join(tmp, "fake-pi-rpc.mjs");
const fakeLog = join(tmp, "fake-pi-commands.jsonl");
const fakeHerdr = join(tmp, "fake-herdr.mjs");
const fakeHerdrLog = join(tmp, "fake-herdr-commands.jsonl");
const fakeLifecycleLog = join(tmp, "fake-lifecycle.jsonl");
const staleSocket = join(socketDir, "stale.sock");
const staleRegistry = join(registryDir, "stale.json");
const malformedRegistry = join(registryDir, "malformed.json");
const orphanSocket = join(socketDir, "bridge-2147483646.sock");
mkdirSync(socketDir, { recursive: true });
mkdirSync(registryDir, { recursive: true });
writeFileSync(staleSocket, "stale");
writeFileSync(orphanSocket, "orphan");
writeFileSync(staleRegistry, JSON.stringify({ pid: 2_147_483_647, socketPath: staleSocket }));
writeFileSync(malformedRegistry, "not-json");

writeFileSync(fakeHerdr, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");
if (args.includes("report-agent") && process.env.FAKE_TRACK_HERDR_REPORTS === "1") {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_HERDR_REPORT_DELAY_MS || 0)));
  appendFileSync(process.env.FAKE_LIFECYCLE_LOG, JSON.stringify("report-completed") + "\\n");
}
if (args.includes("release-agent")) {
  appendFileSync(process.env.FAKE_LIFECYCLE_LOG, JSON.stringify("authority-released") + "\\n");
}
`);
chmodSync(fakeHerdr, 0o755);

writeFileSync(fakePi, `
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const sessionId = "bridge-test-session";
const sessionFile = "${join(tmp, "bridge-test-session.jsonl").replaceAll("\\", "\\\\")}";
const logPath = process.env.FAKE_PI_LOG;
const rl = readline.createInterface({ input: process.stdin });

process.on("SIGTERM", () => {
  if (process.env.FAKE_PI_IGNORE_SIGTERM === "1") {
    appendFileSync(process.env.FAKE_LIFECYCLE_LOG, JSON.stringify("term-ignored") + "\\n");
    return;
  }
  appendFileSync(process.env.FAKE_LIFECYCLE_LOG, JSON.stringify("child-stopped") + "\\n");
  process.exit(0);
});

function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

rl.on("line", (line) => {
  const command = JSON.parse(line);
  if (logPath) appendFileSync(logPath, JSON.stringify(command) + "\\n");

  if (command.type === "get_state") {
    if (process.env.FAKE_PI_FAIL_STATE === "1") {
      send({ id: command.id, type: "response", command: "get_state", success: false, error: "forced get_state failure" });
      return;
    }
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
    if (process.env.FAKE_PI_EXIT_AFTER_STATE === "1") setTimeout(() => process.exit(7), 50);
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

function waitForProcessExit(child, description, timeoutMs = 15_000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function startLifecycleBridge(name, extraEnv = {}) {
  const lifecycleSocketDir = join(tmp, `${name}-sockets`);
  const lifecycleRegistryDir = join(tmp, `${name}-registry`);
  const lifecycleLog = join(tmp, `${name}-lifecycle.jsonl`);
  const child = spawn(process.execPath, [
    "bin/pi-web-rpc-bridge.js",
    "--socket-dir", lifecycleSocketDir,
    "--registry-dir", lifecycleRegistryDir,
    "--herdr-command", fakeHerdr,
    "--",
    process.execPath,
    fakePi,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_PI_LOG: join(tmp, `${name}-pi.jsonl`),
      FAKE_HERDR_LOG: join(tmp, `${name}-herdr.jsonl`),
      FAKE_LIFECYCLE_LOG: lifecycleLog,
      HERDR_PANE_ID: `${name}-pane`,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  return { child, lifecycleSocketDir, lifecycleRegistryDir, lifecycleLog, getStderr: () => stderr };
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
  "--herdr-command", fakeHerdr,
  "--",
  process.execPath,
  fakePi,
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FAKE_PI_LOG: fakeLog,
    FAKE_HERDR_LOG: fakeHerdrLog,
    FAKE_LIFECYCLE_LOG: fakeLifecycleLog,
    HERDR_PANE_ID: "test-pane",
  },
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
    if (existsSync(staleRegistry) || existsSync(orphanSocket)) return null;
    const files = readdirSync(registryDir).filter((file) => file.endsWith(".json") && file !== "malformed.json");
    return files.length === 1 ? join(registryDir, files[0]) : null;
  });

  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(existsSync(staleRegistry), false, "bridge startup should prune dead registry entries");
  assert.equal(existsSync(staleSocket), false, "bridge startup should prune sockets owned by dead registry entries");
  assert.equal(existsSync(malformedRegistry), true, "bridge startup should preserve entries whose owner cannot be proven dead");
  assert.equal(existsSync(orphanSocket), false, "bridge startup should prune orphan sockets whose owning PID is dead");
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

  bridge.kill("SIGTERM");
  await new Promise((resolve) => bridge.once("exit", resolve));
  const herdrCommands = await waitFor("Herdr authority release", () => {
    const commands = readFileSync(fakeHerdrLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    return commands.some((args) => args.includes("release-agent")) ? commands : null;
  });
  assert.ok(herdrCommands.some((args) => args.includes("release-agent")), "bridge shutdown should release its Herdr agent authority");
  const lifecycleEvents = readFileSync(fakeLifecycleLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lifecycleEvents, ["child-stopped", "authority-released"], "the Pi writer must stop before Herdr authority is released");
  assert.equal(existsSync(registryPath), false, "bridge shutdown should remove its registry entry");
  assert.equal(existsSync(registry.socketPath), false, "bridge shutdown should remove its command socket");

  const failedSetup = startLifecycleBridge("f", { FAKE_PI_FAIL_STATE: "1" });
  const failedExit = await waitForProcessExit(failedSetup.child, "failed setup bridge exit");
  assert.equal(failedExit.code, 1, "a setup failure should exit unsuccessfully");
  assert.deepEqual(readdirSync(failedSetup.lifecycleRegistryDir), [], "setup failure should not leave registry entries");
  assert.deepEqual(readdirSync(failedSetup.lifecycleSocketDir), [], "setup failure should not leave sockets");
  const failedLifecycle = readFileSync(failedSetup.lifecycleLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(failedLifecycle, ["child-stopped", "authority-released"], "setup failure should stop the writer before releasing authority");

  const childFailure = startLifecycleBridge("e", { FAKE_PI_EXIT_AFTER_STATE: "1" });
  const childFailureExit = await waitForProcessExit(childFailure.child, "unexpected child failure bridge exit");
  assert.equal(childFailureExit.code, 1, "unexpected Pi child failure should make the bridge exit unsuccessfully");
  assert.deepEqual(readdirSync(childFailure.lifecycleRegistryDir), [], "child failure should remove registry entries");
  assert.deepEqual(readdirSync(childFailure.lifecycleSocketDir), [], "child failure should remove sockets");
  const childFailureLifecycle = readFileSync(childFailure.lifecycleLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(childFailureLifecycle, ["authority-released"], "child failure should release authority after the writer exits");

  const forcedShutdown = startLifecycleBridge("k", { FAKE_PI_IGNORE_SIGTERM: "1" });
  await waitFor("forced shutdown registry", () => {
    const files = readdirSync(forcedShutdown.lifecycleRegistryDir);
    return files.length === 1 ? files[0] : null;
  });
  forcedShutdown.child.kill("SIGTERM");
  const forcedExit = await waitForProcessExit(forcedShutdown.child, "forced bridge shutdown");
  assert.equal(forcedExit.code, 0, `bridge should finish cleanly after escalating child shutdown:\n${forcedShutdown.getStderr()}`);
  const forcedLifecycle = readFileSync(forcedShutdown.lifecycleLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(forcedLifecycle, ["term-ignored", "authority-released"], "bridge should release authority only after escalating an ignored TERM");
  assert.deepEqual(readdirSync(forcedShutdown.lifecycleRegistryDir), [], "forced shutdown should remove registry entries");
  assert.deepEqual(readdirSync(forcedShutdown.lifecycleSocketDir), [], "forced shutdown should remove sockets");

  const pendingReport = startLifecycleBridge("r", {
    FAKE_TRACK_HERDR_REPORTS: "1",
    FAKE_HERDR_REPORT_DELAY_MS: "500",
  });
  await waitFor("pending report registry", () => {
    const files = readdirSync(pendingReport.lifecycleRegistryDir);
    return files.length === 1 ? files[0] : null;
  });
  pendingReport.child.kill("SIGTERM");
  await waitForProcessExit(pendingReport.child, "pending report bridge shutdown");
  const reportLifecycle = readFileSync(pendingReport.lifecycleLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(reportLifecycle, ["child-stopped", "report-completed", "authority-released"], "pending Herdr reports must finish before authority is released");

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
