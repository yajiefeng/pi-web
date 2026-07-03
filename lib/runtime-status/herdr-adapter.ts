import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HerdrAgentRuntimeStatus, HerdrHealth, HerdrStatusSnapshot, RuntimeStatus } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 1200;
const HERDR_BIN = process.env.HERDR_BIN || "herdr";

export type HerdrCommandRunner = (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;

export async function getHerdrStatusSnapshot(options: {
  run?: HerdrCommandRunner;
  timeoutMs?: number;
} = {}): Promise<HerdrStatusSnapshot> {
  const run = options.run ?? runHerdr;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const status = await run(["status", "--json"], { timeoutMs });
    const health = readHerdrHealth(status.stdout);
    if (health !== "ok") return { agents: [], health };

    const list = await run(["agent", "list"], { timeoutMs });
    return { agents: parseHerdrAgentList(list.stdout), health: "ok" };
  } catch (error) {
    const message = errorMessage(error);
    return {
      agents: [],
      health: isConnectionRefused(message) ? "unavailable" : "error",
      error: message,
    };
  }
}

async function runHerdr(args: string[], options: { timeoutMs: number }): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(HERDR_BIN, args, {
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function readHerdrHealth(stdout: string): HerdrHealth {
  try {
    const data = JSON.parse(stdout) as { server?: { running?: boolean; status?: string } };
    if (data.server?.running === true || data.server?.status === "running") return "ok";
    if (data.server?.running === false || data.server?.status === "not_running") return "unavailable";
    return "error";
  } catch {
    return stdout.trim() ? "error" : "unavailable";
  }
}

export function parseHerdrAgentList(stdout: string): HerdrAgentRuntimeStatus[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const fromJson = parseJsonAgentList(trimmed);
  if (fromJson) return fromJson;

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isLikelyHeader(line))
    .map(parseAgentLine)
    .filter((agent): agent is HerdrAgentRuntimeStatus => agent !== null);
}

function parseJsonAgentList(text: string): HerdrAgentRuntimeStatus[] | null {
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const data = JSON.parse(text) as unknown;
    const result = isRecord(data) && isRecord(data.result) ? data.result : data;
    const records = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.agents)
        ? result.agents
        : isRecord(result) && Array.isArray(result.panes)
          ? result.panes
          : isRecord(result) && isRecord(result.agent)
            ? [result.agent]
            : isRecord(result) && isRecord(result.pane)
              ? [result.pane]
              : null;
    if (!records) return null;
    return records
      .map((record, index) => normalizeJsonAgent(record, index))
      .filter((agent): agent is HerdrAgentRuntimeStatus => agent !== null);
  } catch {
    return null;
  }
}

function normalizeJsonAgent(record: unknown, index: number): HerdrAgentRuntimeStatus | null {
  if (!isRecord(record)) return null;
  const status = normalizeStatus(readString(record, "status") ?? readString(record, "state") ?? readString(record, "agent_status"));
  const id = readString(record, "id")
    ?? readString(record, "terminalId")
    ?? readString(record, "terminal_id")
    ?? readString(record, "paneId")
    ?? readString(record, "pane_id")
    ?? `herdr-agent-${index + 1}`;
  const label = readString(record, "label")
    ?? readString(record, "name")
    ?? readString(record, "agent")
    ?? readString(record, "displayAgent")
    ?? readString(record, "display_agent")
    ?? id;
  const nestedSession = readAgentSessionRef(record);
  const sessionId = readString(record, "agentSessionId") ?? readString(record, "agent_session_id") ?? readString(record, "agent-session-id") ?? readString(record, "sessionId") ?? readString(record, "session_id") ?? nestedSession.sessionId;
  const sessionPath = readString(record, "agentSessionPath") ?? readString(record, "agent_session_path") ?? readString(record, "agent-session-path") ?? readString(record, "sessionPath") ?? readString(record, "session_path") ?? nestedSession.sessionPath;

  return {
    id,
    label,
    status,
    source: "herdr",
    linked: Boolean(sessionId || sessionPath),
    ...(readString(record, "terminalId") || readString(record, "terminal_id") ? { terminalId: readString(record, "terminalId") ?? readString(record, "terminal_id") } : {}),
    ...(readString(record, "paneId") || readString(record, "pane_id") ? { paneId: readString(record, "paneId") ?? readString(record, "pane_id") } : {}),
    ...(readString(record, "cwd") ? { cwd: readString(record, "cwd") } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionPath ? { sessionPath } : {}),
    ...(readString(record, "message") || readString(record, "custom_status") || readString(record, "customStatus") ? { message: readString(record, "message") ?? readString(record, "custom_status") ?? readString(record, "customStatus") } : {}),
  };
}

function parseAgentLine(line: string): HerdrAgentRuntimeStatus | null {
  const values = readKeyValues(line);
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const status = normalizeStatus(values.status ?? values.state ?? line.match(/\b(idle|working|blocked|done|unknown)\b/i)?.[1]);
  const id = values.id ?? values.terminal_id ?? values.terminalId ?? values.pane_id ?? values.paneId ?? values.pane ?? tokens[0];
  const statusIndex = tokens.findIndex((token) => normalizeStatus(token) !== "unknown" || /^unknown$/i.test(token));
  const label = values.label ?? values.name ?? values.agent ?? values.display_agent ?? values.displayAgent
    ?? (statusIndex > 1 ? tokens.slice(1, statusIndex).join(" ") : tokens[1])
    ?? id;
  const sessionId = values.agent_session_id ?? values.agentSessionId ?? values["agent-session-id"] ?? values.session_id ?? values.sessionId;
  const sessionPath = values.agent_session_path ?? values.agentSessionPath ?? values["agent-session-path"] ?? values.session_path ?? values.sessionPath;

  return {
    id,
    label,
    status,
    source: "herdr",
    linked: Boolean(sessionId || sessionPath),
    ...(values.terminal_id || values.terminalId ? { terminalId: values.terminal_id ?? values.terminalId } : {}),
    ...(values.pane_id || values.paneId || values.pane ? { paneId: values.pane_id ?? values.paneId ?? values.pane } : {}),
    ...(values.cwd ? { cwd: values.cwd } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionPath ? { sessionPath } : {}),
    ...(values.message || values.custom_status || values.customStatus ? { message: values.message ?? values.custom_status ?? values.customStatus } : {}),
    raw: line,
  };
}

function readAgentSessionRef(record: Record<string, unknown>): { sessionId?: string; sessionPath?: string } {
  const agentSession = record["agent_session"] ?? record.agentSession;
  if (!isRecord(agentSession)) return {};

  const kind = readString(agentSession, "kind");
  const value = readString(agentSession, "value");
  if (!value) return {};

  if (kind === "id") return { sessionId: value };
  if (kind === "path") return { sessionPath: value };
  return {};
}

function readKeyValues(line: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|\S+)/g;
  for (const match of line.matchAll(pattern)) {
    const key = match[1];
    const raw = match[2];
    if (!key || !raw) continue;
    values[key] = raw.replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function normalizeStatus(value: string | undefined): RuntimeStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "idle" || normalized === "working" || normalized === "blocked" || normalized === "done" || normalized === "unknown") {
    return normalized;
  }
  return "unknown";
}

function isLikelyHeader(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("agent") && lower.includes("status") && !line.includes("=");
}

function isConnectionRefused(message: string): boolean {
  return /connection refused|not_running|code:\s*61|os \{ code: 61/i.test(message);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message];
    const maybe = error as Error & { stderr?: string; stdout?: string; signal?: string };
    if (maybe.stderr) details.push(maybe.stderr);
    if (maybe.stdout) details.push(maybe.stdout);
    if (maybe.signal === "SIGTERM") details.push("timeout");
    return details.filter(Boolean).join("\n");
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
