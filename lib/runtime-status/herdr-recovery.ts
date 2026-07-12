import { resolve } from "node:path";
import type { HerdrAgentCreationResult, StartHerdrAgentInput } from "./herdr-control.ts";
import type { HerdrAgentRuntimeStatus, HerdrStatusSnapshot, SessionRuntimeReference } from "./types.ts";

export type HerdrRecoveryAction = "retry_binding" | "cleanup";

export class HerdrRecoveryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HerdrRecoveryError";
    this.status = status;
  }
}

export interface HerdrRecoveryDependencies {
  getSnapshot: () => Promise<HerdrStatusSnapshot>;
  sessionRefs: SessionRuntimeReference[];
  close: (agent: HerdrAgentRuntimeStatus) => Promise<void>;
  start: (input: StartHerdrAgentInput) => Promise<HerdrAgentCreationResult>;
  resolveValidSessionFile: (path: string) => string | undefined;
  authorizeCwd?: (cwd: string) => void;
}

export async function recoverHerdrRuntime(
  input: { agentId: string; action: HerdrRecoveryAction },
  dependencies: HerdrRecoveryDependencies,
): Promise<{
  ok: true;
  action: HerdrRecoveryAction;
  agentId: string;
  replacement?: HerdrAgentCreationResult;
}> {
  const snapshot = await dependencies.getSnapshot();
  if (snapshot.health !== "ok") {
    throw new HerdrRecoveryError(503, `Cannot recover runtime while Herdr is ${snapshot.health}`);
  }

  const agent = snapshot.agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) throw new HerdrRecoveryError(404, "Runtime diagnostic no longer exists");
  if (isRepresented(agent, dependencies.sessionRefs)) {
    throw new HerdrRecoveryError(409, "Resolved runtime cannot be changed from Runtime diagnostics");
  }

  if (input.action === "cleanup") {
    await dependencies.close(agent);
    return { ok: true, action: input.action, agentId: agent.id };
  }

  if (!agent.cwd) throw new HerdrRecoveryError(409, "Cannot retry binding because the runtime has no working directory");
  dependencies.authorizeCwd?.(agent.cwd);
  const sessionFile = agent.sessionPath
    ? dependencies.resolveValidSessionFile(agent.sessionPath)
    : undefined;

  await dependencies.close(agent);
  const replacement = await dependencies.start({ cwd: agent.cwd, ...(sessionFile ? { sessionFile } : {}) });
  return { ok: true, action: input.action, agentId: agent.id, replacement };
}

function isRepresented(agent: HerdrAgentRuntimeStatus, sessionRefs: SessionRuntimeReference[]): boolean {
  const agentPath = agent.sessionPath ? resolve(agent.sessionPath) : undefined;
  return sessionRefs.some((session) => (
    (Boolean(agent.sessionId) && session.sessionId === agent.sessionId)
    || (Boolean(agentPath) && Boolean(session.sessionFile) && resolve(session.sessionFile!) === agentPath)
  ));
}
