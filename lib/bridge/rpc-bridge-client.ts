import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface BridgeSessionReference {
  sessionId?: string;
  sessionFile?: string;
}

export interface BridgeRegistryEntry {
  version: 1;
  pid: number;
  socketPath: string;
  token: string;
  cwd?: string;
  sessionId?: string;
  sessionFile?: string;
  protocol?: string;
  protocolVersion?: number;
  capabilities: string[];
  updatedAt?: string;
}

export interface BridgeCommandRequest {
  id: string;
  expectedSessionId?: string;
  expectedSessionFile?: string;
  command: {
    type: string;
    message?: string;
    images?: unknown[];
    [key: string]: unknown;
  };
}

export interface BridgeCommandResponse {
  id?: string;
  accepted: boolean;
  state?: string;
  command?: string;
  sessionId?: string;
  sessionFile?: string;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface BridgeRegistryLookupOptions {
  registryDir?: string;
}

export interface BridgeCommandOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function getDefaultBridgeRegistryDir(): string {
  return process.env.PI_WEB_RPC_BRIDGE_REGISTRY_DIR || join(homedir(), ".pi", "agent", "pi-web-rpc-bridge", "registry");
}

export async function findBridgeRegistryForSession(
  session: BridgeSessionReference,
  options: BridgeRegistryLookupOptions = {},
): Promise<BridgeRegistryEntry | null> {
  const registryDir = options.registryDir ?? getDefaultBridgeRegistryDir();
  let files: string[];
  try {
    files = await readdir(registryDir);
  } catch {
    return null;
  }

  const candidates: BridgeRegistryEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const entry = await readRegistryEntry(join(registryDir, file));
    if (!entry) continue;
    if (!isLiveRegistry(entry)) continue;
    if (!registryMatchesSession(entry, session)) continue;
    candidates.push(entry);
  }

  candidates.sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  return candidates[0] ?? null;
}

export function sendBridgeCommand(
  registry: BridgeRegistryEntry,
  request: BridgeCommandRequest,
  options: BridgeCommandOptions = {},
): Promise<BridgeCommandResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = { ...request, token: registry.token };

  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection(registry.socketPath);
    let buffer = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settle(() => reject(new Error("Timed out waiting for bridge response")));
      socket.destroy();
    }, timeoutMs);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(JSON.stringify(payload) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      settle(() => {
        socket.end();
        try {
          resolvePromise(JSON.parse(line) as BridgeCommandResponse);
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.on("error", (error) => settle(() => reject(error)));
  });
}

export interface BridgeEventSubscription {
  close(): void;
}

export interface BridgeEventHandlers {
  onEvent(event: unknown): void;
  onError?(error: Error): void;
  onClose?(): void;
}

export async function subscribeBridgeEvents(
  registry: BridgeRegistryEntry,
  request: BridgeCommandRequest,
  handlers: BridgeEventHandlers,
  options: BridgeCommandOptions = {},
): Promise<BridgeEventSubscription> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = { ...request, command: { type: "subscribe" }, token: registry.token };

  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection(registry.socketPath);
    let buffer = "";
    let subscribed = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!subscribed) {
        settle(() => reject(new Error("Timed out waiting for bridge subscription")));
        socket.destroy();
      }
    }, timeoutMs);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    }

    function close(): void {
      socket.end();
      socket.destroy();
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(JSON.stringify(payload) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch (error) {
          const parsedError = error instanceof Error ? error : new Error(String(error));
          if (!subscribed) settle(() => reject(parsedError));
          else handlers.onError?.(parsedError);
          continue;
        }

        if (!subscribed) {
          const response = message as BridgeCommandResponse;
          if (!response.accepted) {
            settle(() => reject(new Error(response.errorMessage ?? "Bridge rejected event subscription")));
            close();
            return;
          }
          subscribed = true;
          settle(() => resolvePromise({ close }));
          continue;
        }

        handlers.onEvent(message);
      }
    });
    socket.on("error", (error) => {
      if (!subscribed) settle(() => reject(error));
      else handlers.onError?.(error);
    });
    socket.on("close", () => handlers.onClose?.());
  });
}

async function readRegistryEntry(filePath: string): Promise<BridgeRegistryEntry | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeRegistryEntry>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.pid !== "number") return null;
    if (typeof parsed.socketPath !== "string") return null;
    if (typeof parsed.token !== "string") return null;
    return {
      version: 1,
      pid: parsed.pid,
      socketPath: parsed.socketPath,
      token: parsed.token,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      sessionFile: typeof parsed.sessionFile === "string" ? parsed.sessionFile : undefined,
      protocol: typeof parsed.protocol === "string" ? parsed.protocol : undefined,
      protocolVersion: typeof parsed.protocolVersion === "number" ? parsed.protocolVersion : undefined,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.filter((item): item is string => typeof item === "string") : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

function isLiveRegistry(entry: BridgeRegistryEntry): boolean {
  if (!existsSync(entry.socketPath)) return false;
  try {
    process.kill(entry.pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EPERM";
  }
}

function registryMatchesSession(entry: BridgeRegistryEntry, session: BridgeSessionReference): boolean {
  if (session.sessionId && entry.sessionId && session.sessionId !== entry.sessionId) return false;

  const expectedFile = normalizePath(session.sessionFile);
  const entryFile = normalizePath(entry.sessionFile);
  if (expectedFile && entryFile && expectedFile !== entryFile) return false;

  return Boolean(
    (session.sessionId && entry.sessionId === session.sessionId)
      || (expectedFile && entryFile === expectedFile),
  );
}

function normalizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return resolve(value);
}
