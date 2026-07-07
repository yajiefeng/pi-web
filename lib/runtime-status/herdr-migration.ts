import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { validateCwdDirectory } from "../cwd-validation.ts";
import { closeHerdrAgentPane, HerdrControlError, startHerdrAgent, type HerdrAgentCreationResult, type StartHerdrAgentInput } from "./herdr-control.ts";
import type { HerdrAgentRuntimeStatus, RuntimeStatusSnapshot } from "./types.ts";

type StartHerdrAgent = (input: StartHerdrAgentInput) => Promise<HerdrAgentCreationResult>;
type CloseHerdrAgent = (agent: HerdrAgentRuntimeStatus) => Promise<void>;
type GetSnapshot = () => Promise<RuntimeStatusSnapshot>;
type ResolveSessionPath = (sessionId: string) => Promise<string | null>;
type ReadSessionCwd = (sessionFile: string) => string | undefined;

type MigrationOptions = {
  start?: StartHerdrAgent;
  closeOldAgent?: CloseHerdrAgent;
  getSnapshot?: GetSnapshot;
  resolveSession?: ResolveSessionPath;
  readSessionCwd?: ReadSessionCwd;
  allowRoot?: (cwd: string) => void;
  random?: () => string;
  waitTimeoutMs?: number;
  waitIntervalMs?: number;
};

type MigrationBody = {
  sessionId?: unknown;
  sessionFile?: unknown;
  oldAgentId?: unknown;
  confirmStopOldAgent?: unknown;
};

const DEFAULT_RELEASE_TIMEOUT_MS = 5_000;
const DEFAULT_RELEASE_INTERVAL_MS = 250;

export async function migrateHerdrTuiSessionToBridgeResponse(
  req: Request,
  options: MigrationOptions = {},
): Promise<Response> {
  let body: MigrationBody;
  try {
    body = await req.json() as MigrationBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const providedSessionFile = typeof body.sessionFile === "string" ? body.sessionFile.trim() : "";
  const oldAgentId = typeof body.oldAgentId === "string" ? body.oldAgentId.trim() : "";

  if (!sessionId) return Response.json({ ok: false, error: "sessionId is required" }, { status: 400 });
  if (!providedSessionFile) return Response.json({ ok: false, error: "sessionFile is required" }, { status: 400 });
  if (!oldAgentId) return Response.json({ ok: false, error: "oldAgentId is required" }, { status: 400 });
  if (body.confirmStopOldAgent !== true) {
    return Response.json({
      ok: false,
      error: "Migration requires explicit confirmation to stop the old Herdr TUI runtime before starting the bridge.",
      errorCode: "confirmation_required",
    }, { status: 409 });
  }

  const resolveSelectedSession = options.resolveSession ?? defaultResolveSessionPath;
  const resolvedSessionFile = await resolveSelectedSession(sessionId);
  if (!resolvedSessionFile) {
    return Response.json({ ok: false, error: "Session not found", errorCode: "session_not_found" }, { status: 404 });
  }

  if (normalizePath(providedSessionFile) !== normalizePath(resolvedSessionFile)) {
    return Response.json({
      ok: false,
      error: "Selected session file does not match the server-resolved session file.",
      errorCode: "session_mismatch",
    }, { status: 409 });
  }

  const getSnapshot = options.getSnapshot ?? defaultGetRuntimeStatusSnapshot;
  const snapshot = await getSnapshot();
  const status = snapshot.sessions[sessionId];
  if (!status?.herdrAgentId) {
    return Response.json({
      ok: false,
      error: "Selected session is not currently bound to a Herdr runtime.",
      errorCode: "not_herdr_owned",
    }, { status: 409 });
  }
  if (status.herdrAgentId !== oldAgentId) {
    return Response.json({
      ok: false,
      error: "Selected session is bound to a different Herdr agent than the migration request.",
      errorCode: "agent_mismatch",
    }, { status: 409 });
  }
  if (status.sessionFile && normalizePath(status.sessionFile) !== normalizePath(resolvedSessionFile)) {
    return Response.json({
      ok: false,
      error: "Runtime status session file does not match the selected session file.",
      errorCode: "session_mismatch",
    }, { status: 409 });
  }
  if (status.bridgeCapable) {
    return Response.json({
      ok: false,
      error: "Selected Herdr session is already bridge-capable.",
      errorCode: "already_bridge_capable",
    }, { status: 409 });
  }

  const oldAgent = snapshot.herdrAgents.find((agent) => agent.id === oldAgentId);
  if (!oldAgent) {
    return Response.json({
      ok: false,
      error: "Could not confirm the old Herdr agent before migration.",
      errorCode: "old_agent_missing",
    }, { status: 409 });
  }
  if (!agentMatchesSelectedSession(oldAgent, sessionId, resolvedSessionFile)) {
    return Response.json({
      ok: false,
      error: "Old Herdr agent does not report the selected session id/path.",
      errorCode: "agent_session_mismatch",
    }, { status: 409 });
  }

  const closeOldAgent = options.closeOldAgent ?? closeHerdrAgentPane;
  try {
    await closeOldAgent(oldAgent);
  } catch (error) {
    return mapMigrationError(error, "Failed to stop the old Herdr TUI runtime");
  }

  const released = await waitForHerdrAgentRelease({
    oldAgentId,
    sessionId,
    sessionFile: resolvedSessionFile,
    getSnapshot,
    timeoutMs: options.waitTimeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS,
    intervalMs: options.waitIntervalMs ?? DEFAULT_RELEASE_INTERVAL_MS,
  });
  if (!released) {
    return Response.json({
      ok: false,
      error: "Old Herdr runtime still appears active after close; refusing to start a bridge writer for the same session file.",
      errorCode: "old_agent_still_active",
    }, { status: 409 });
  }

  const cwd = readCwdForSession(resolvedSessionFile, options.readSessionCwd);
  if (!cwd) {
    return Response.json({ ok: false, error: "Selected session does not include a cwd", errorCode: "missing_cwd" }, { status: 400 });
  }
  const validation = validateCwdDirectory(cwd);
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error, errorCode: "invalid_cwd" }, { status: 400 });
  }
  options.allowRoot?.(validation.cwd);

  try {
    const start = options.start ?? ((input: StartHerdrAgentInput) => startHerdrAgent(input));
    const result = await start({
      cwd: validation.cwd,
      sessionFile: resolvedSessionFile,
      ...(options.random ? { random: options.random } : {}),
    });
    return Response.json({
      ...result,
      migrated: true,
      previousAgentId: oldAgentId,
      sessionId,
      sessionFile: resolvedSessionFile,
    });
  } catch (error) {
    return mapMigrationError(error, "Failed to start bridge-owned Herdr runtime");
  }
}

export async function waitForHerdrAgentRelease(input: {
  oldAgentId: string;
  sessionId: string;
  sessionFile: string;
  getSnapshot?: GetSnapshot;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const getSnapshot = input.getSnapshot ?? defaultGetRuntimeStatusSnapshot;
  const timeoutMs = input.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? DEFAULT_RELEASE_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const snapshot = await getSnapshot();
    const oldAgentStillListed = snapshot.herdrAgents.some((agent) => agent.id === input.oldAgentId);
    const oldSessionBindingStillActive = Object.values(snapshot.sessions).some((status) => {
      if (status.herdrAgentId !== input.oldAgentId) return false;
      if (status.sessionId === input.sessionId) return true;
      return Boolean(status.sessionFile && normalizePath(status.sessionFile) === normalizePath(input.sessionFile));
    });
    if (!oldAgentStillListed && !oldSessionBindingStillActive) return true;
    await sleep(intervalMs);
  }

  return false;
}

async function defaultResolveSessionPath(sessionId: string): Promise<string | null> {
  const mod = await import("../session-reader.ts");
  return mod.resolveSessionPath(sessionId);
}

async function defaultGetRuntimeStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
  const mod = await import("./provider.ts");
  return mod.getRuntimeStatusSnapshot();
}

function agentMatchesSelectedSession(agent: HerdrAgentRuntimeStatus, sessionId: string, sessionFile: string): boolean {
  if (agent.sessionId && agent.sessionId !== sessionId) return false;
  if (agent.sessionPath && normalizePath(agent.sessionPath) !== normalizePath(sessionFile)) return false;
  return Boolean(agent.sessionId === sessionId || (agent.sessionPath && normalizePath(agent.sessionPath) === normalizePath(sessionFile)));
}

function readCwdForSession(sessionFile: string, readSessionCwd: ReadSessionCwd | undefined): string | undefined {
  if (readSessionCwd) return readSessionCwd(sessionFile);
  return SessionManager.open(sessionFile).getHeader()?.cwd;
}

function mapMigrationError(error: unknown, fallback: string): Response {
  if (error instanceof HerdrControlError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  return Response.json({
    ok: false,
    error: error instanceof Error ? `${fallback}: ${error.message}` : `${fallback}: ${String(error)}`,
  }, { status: 500 });
}

function normalizePath(value: string): string {
  return resolve(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
