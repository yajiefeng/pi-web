#!/usr/bin/env node
"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const DEFAULT_BASE_DIR = path.join(os.homedir(), ".pi", "agent", "pi-web-rpc-bridge");
const DEFAULT_SOURCE = "pi-web-rpc-bridge";
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

function usage() {
  return `Usage: pi-web-rpc-bridge [options] [-- <pi-rpc-command...>]

Starts a Pi RPC child process, owns its JSONL stdin/stdout protocol, and exposes
a local command socket for pi-web.

Options:
  --socket-dir PATH       Directory for the Unix command socket
  --registry-dir PATH     Directory for registry JSON files
  --token VALUE           Command socket token (default: random)
  --herdr-command PATH    herdr executable for status reports (default: herdr)
  --herdr-source ID       Herdr report source id (default: ${DEFAULT_SOURCE})
  --no-herdr-report       Disable Herdr pane report commands
  --help                  Show this help

Default child command: pi --mode rpc
`;
}

function parseArgs(argv) {
  const options = {
    socketDir: path.join(DEFAULT_BASE_DIR, "sockets"),
    registryDir: path.join(DEFAULT_BASE_DIR, "registry"),
    token: undefined,
    herdrCommand: process.env.PI_WEB_RPC_BRIDGE_HERDR_COMMAND || "herdr",
    herdrSource: DEFAULT_SOURCE,
    herdrReport: true,
    piArgv: undefined,
  };

  const delimiterIndex = argv.indexOf("--");
  const optionArgs = delimiterIndex === -1 ? argv : argv.slice(0, delimiterIndex);
  const piArgv = delimiterIndex === -1 ? [] : argv.slice(delimiterIndex + 1);

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    const nextValue = () => {
      const value = optionArgs[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg === "--socket-dir") {
      options.socketDir = nextValue();
    } else if (arg === "--registry-dir") {
      options.registryDir = nextValue();
    } else if (arg === "--token") {
      options.token = nextValue();
    } else if (arg === "--herdr-command") {
      options.herdrCommand = nextValue();
    } else if (arg === "--herdr-source") {
      options.herdrSource = nextValue();
    } else if (arg === "--no-herdr-report") {
      options.herdrReport = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.piArgv = piArgv.length > 0 ? piArgv : ["pi", "--mode", "rpc"];
  return options;
}

function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort on platforms/filesystems that do not support chmod.
  }
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160) || "session";
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", { mode });
  try {
    fs.chmodSync(tmpPath, mode);
  } catch {
    // Best-effort.
  }
  fs.renameSync(tmpPath, filePath);
}

function serializeJsonLine(value) {
  return JSON.stringify(value) + "\n";
}

function normalizeComparablePath(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return path.resolve(value);
}

function createErrorResponse(id, errorCode, errorMessage, session) {
  return {
    id,
    accepted: false,
    errorCode,
    errorMessage,
    ...(session ? { sessionId: session.sessionId, sessionFile: session.sessionFile } : {}),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirPrivate(options.socketDir);
  mkdirPrivate(options.registryDir);

  const token = options.token || crypto.randomBytes(24).toString("base64url");
  const childCommand = options.piArgv[0];
  const childArgs = options.piArgv.slice(1);
  if (!childCommand) throw new Error("Pi RPC command must not be empty");

  let currentSession;
  let registryPath;
  const socketPath = path.join(options.socketDir, `bridge-${process.pid}.sock`);
  const subscribers = new Set();
  const capabilities = [
    "prompt",
    "steer",
    "follow_up",
    "abort",
    "compact",
    "get_state",
    "get_commands",
    "set_model",
    "get_available_models",
    "set_thinking_level",
    "set_steering_mode",
    "set_follow_up_mode",
    "set_auto_compaction",
    "set_auto_retry",
    "abort_retry",
    "abort_bash",
    "get_session_stats",
    "get_fork_messages",
    "get_last_assistant_text",
    "set_session_name",
    "get_messages",
    "extension_ui_response",
  ];
  let server;
  let childExited = false;
  let shuttingDown = false;
  let rpcSeq = 0;
  let herdrSeq = 0;
  let lastReportedState;
  const pending = new Map();

  try {
    fs.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const child = spawn(childCommand, childArgs, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[pi-rpc] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    childExited = true;
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(new Error(`Pi RPC child exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`));
    }
    pending.clear();
    if (!shuttingDown) {
      reportHerdr("blocked", `Pi RPC child exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`);
    }
  });

  function reportHerdr(state, message) {
    if (!options.herdrReport) return;
    const paneId = process.env.HERDR_PANE_ID;
    if (!paneId) return;
    if (lastReportedState === `${state}:${message || ""}:${currentSession?.sessionId || ""}:${currentSession?.sessionFile || ""}`) {
      return;
    }
    lastReportedState = `${state}:${message || ""}:${currentSession?.sessionId || ""}:${currentSession?.sessionFile || ""}`;

    const args = [
      "pane",
      "report-agent",
      paneId,
      "--source",
      options.herdrSource,
      "--agent",
      "pi",
      "--state",
      state,
      "--seq",
      String(++herdrSeq),
    ];
    if (message) args.push("--message", message.slice(0, 500));
    if (currentSession?.sessionId) args.push("--agent-session-id", currentSession.sessionId);
    if (currentSession?.sessionFile) args.push("--agent-session-path", currentSession.sessionFile);

    execFile(options.herdrCommand, args, { timeout: 5000 }, (error) => {
      if (error) process.stderr.write(`[pi-web-rpc-bridge] Herdr report failed: ${error.message}\n`);
    });
  }

  function broadcastBridgeEvent(event) {
    const line = serializeJsonLine(event);
    for (const subscriber of subscribers) {
      try {
        subscriber.write(line);
      } catch {
        subscribers.delete(subscriber);
      }
    }
  }

  function updateStateFromEvent(event) {
    if (!event || typeof event !== "object") return;
    if (["agent_start", "turn_start", "message_start", "tool_execution_start", "compaction_start", "auto_retry_start"].includes(event.type)) {
      reportHerdr("working");
    }
    if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) {
      reportHerdr("blocked", `Waiting for ${event.method} response`);
    }
    if (["agent_end", "compaction_end", "auto_retry_end"].includes(event.type)) {
      reportHerdr("idle");
    }
  }

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`[pi-web-rpc-bridge] Ignoring non-JSON Pi RPC line: ${error.message}\n`);
      return;
    }

    if (message && typeof message === "object" && "id" in message && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timeout);
      entry.resolve(message);
      return;
    }

    updateStateFromEvent(message);
    broadcastBridgeEvent(message);
  });

  function sendRpcCommand(command, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    if (childExited) throw new Error("Pi RPC child has exited");
    if (!child.stdin.writable) throw new Error("Pi RPC stdin is not writable");
    const id = `bridge-${process.pid}-${++rpcSeq}`;
    const payload = { ...command, id };
    const writeOk = child.stdin.write(serializeJsonLine(payload));
    if (!writeOk) {
      // The pending response still resolves through stdout; backpressure is fine.
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Pi RPC response to ${command.type}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
    });
  }

  function refreshSessionFromState(state) {
    if (!state || typeof state !== "object") throw new Error("Pi RPC get_state returned invalid data");
    const sessionId = typeof state.sessionId === "string" ? state.sessionId : undefined;
    const sessionFile = typeof state.sessionFile === "string" && state.sessionFile.length > 0 ? state.sessionFile : undefined;
    if (!sessionId && !sessionFile) throw new Error("Pi RPC state did not include a session id or session file");
    currentSession = {
      sessionId,
      sessionFile,
      cwd: process.cwd(),
      isStreaming: Boolean(state.isStreaming),
      isCompacting: Boolean(state.isCompacting),
    };
    return currentSession;
  }

  const stateResponse = await sendRpcCommand({ type: "get_state" }, 10_000);
  if (!stateResponse.success) throw new Error(`Pi RPC get_state failed: ${stateResponse.error || "unknown error"}`);
  refreshSessionFromState(stateResponse.data);

  registryPath = path.join(options.registryDir, `${sanitizeFilePart(currentSession.sessionId || path.basename(currentSession.sessionFile))}.json`);
  writeJsonAtomic(registryPath, {
    version: 1,
    pid: process.pid,
    socketPath,
    token,
    cwd: currentSession.cwd,
    sessionId: currentSession.sessionId,
    sessionFile: currentSession.sessionFile,
    protocol: "pi-web-rpc-bridge",
    protocolVersion: 2,
    capabilities,
    child: {
      command: childCommand,
      args: childArgs,
      pid: child.pid,
    },
    updatedAt: new Date().toISOString(),
  });

  reportHerdr(currentSession.isStreaming || currentSession.isCompacting ? "working" : "idle");

  function validateBridgeRequest(request) {
    const id = typeof request?.id === "string" ? request.id : undefined;
    if (!request || typeof request !== "object") return { ok: false, response: createErrorResponse(id, "malformed_request", "Request must be a JSON object", currentSession) };
    if (request.token !== token) return { ok: false, response: createErrorResponse(id, "invalid_token", "Invalid bridge token", currentSession) };

    const expectedSessionId = typeof request.expectedSessionId === "string" ? request.expectedSessionId : undefined;
    const expectedSessionFile = normalizeComparablePath(request.expectedSessionFile);
    const currentSessionFile = normalizeComparablePath(currentSession?.sessionFile);
    if (expectedSessionId && expectedSessionId !== currentSession?.sessionId) {
      return { ok: false, response: createErrorResponse(id, "session_mismatch", "Bridge session id does not match selected session", currentSession) };
    }
    if (expectedSessionFile && currentSessionFile && expectedSessionFile !== currentSessionFile) {
      return { ok: false, response: createErrorResponse(id, "session_mismatch", "Bridge session file does not match selected session", currentSession) };
    }

    const command = request.command;
    if (!command || typeof command !== "object") return { ok: false, response: createErrorResponse(id, "malformed_request", "Missing command object", currentSession) };
    return { ok: true, id, command };
  }

  async function handleBridgeRequest(request) {
    const validation = validateBridgeRequest(request);
    if (!validation.ok) return validation.response;
    const { id, command } = validation;

    if (command.type === "subscribe") {
      return { id, accepted: true, state: "subscribed", command: "subscribe", sessionId: currentSession.sessionId, sessionFile: currentSession.sessionFile };
    }

    if (!capabilities.includes(command.type)) {
      return createErrorResponse(id, "unsupported_command", `Unsupported bridge command: ${String(command.type)}`, currentSession);
    }
    if (["prompt", "steer", "follow_up"].includes(command.type) && (typeof command.message !== "string" || command.message.length === 0)) {
      return createErrorResponse(id, "malformed_request", `${command.type} message must be a non-empty string`, currentSession);
    }

    const rpcPayload = buildRpcPayload(command);
    try {
      const rpcResponse = await sendRpcCommand(rpcPayload);
      if (!rpcResponse.success) {
        return createErrorResponse(id, "pi_rpc_rejected", rpcResponse.error || "Pi RPC rejected command", currentSession);
      }
      if (rpcPayload.type === "get_state") refreshSessionFromState(rpcResponse.data);
      return {
        id,
        accepted: true,
        state: "accepted",
        command: rpcPayload.type,
        sessionId: currentSession.sessionId,
        sessionFile: currentSession.sessionFile,
        ...(rpcResponse.data !== undefined ? { data: rpcResponse.data } : {}),
      };
    } catch (error) {
      return createErrorResponse(id, childExited ? "child_exited" : "pi_rpc_error", error instanceof Error ? error.message : String(error), currentSession);
    }
  }

  function buildRpcPayload(command) {
    switch (command.type) {
      case "prompt":
        return {
          type: "prompt",
          message: command.message,
          ...(Array.isArray(command.images) ? { images: command.images } : {}),
          ...(typeof command.streamingBehavior === "string" ? { streamingBehavior: command.streamingBehavior } : {}),
        };
      case "steer":
      case "follow_up":
        return {
          type: command.type,
          message: command.message,
          ...(Array.isArray(command.images) ? { images: command.images } : {}),
        };
      case "abort":
      case "compact":
      case "get_state":
      case "get_commands":
      case "set_model":
      case "set_thinking_level":
      case "set_auto_compaction":
      case "set_auto_retry":
        return { ...command };
      case "extension_ui_response":
        return { ...command };
      default:
        return { ...command };
    }
  }

  server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let request;
        try {
          request = JSON.parse(line);
        } catch (error) {
          socket.write(serializeJsonLine(createErrorResponse(undefined, "malformed_json", error.message, currentSession)));
          continue;
        }
        const validation = validateBridgeRequest(request);
        if (validation.ok && validation.command.type === "subscribe") {
          subscribers.add(socket);
          socket.write(serializeJsonLine({
            id: validation.id,
            accepted: true,
            state: "subscribed",
            command: "subscribe",
            sessionId: currentSession.sessionId,
            sessionFile: currentSession.sessionFile,
          }));
          socket.on("close", () => subscribers.delete(socket));
          socket.on("error", () => subscribers.delete(socket));
          continue;
        }
        void (validation.ok ? handleBridgeRequest(request) : Promise.resolve(validation.response)).then((response) => {
          socket.write(serializeJsonLine(response));
        });
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {
        // Best-effort.
      }
      resolve();
    });
  });

  process.stderr.write(`[pi-web-rpc-bridge] Ready for session ${currentSession.sessionId || currentSession.sessionFile} at ${socketPath}\n`);

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (server) server.close(() => {});
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    if (child && !childExited) child.kill(signal || "SIGTERM");
    setTimeout(() => process.exit(0), 100).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await new Promise(() => {});
}

main().catch((error) => {
  process.stderr.write(`[pi-web-rpc-bridge] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
