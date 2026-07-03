import type { HerdrAgentRuntimeStatus, HerdrStatusSnapshot, SessionRuntimeReference } from "./types";

export interface HerdrFocusResult {
  ok: true;
  focusedAgentId: string;
  agentLabel: string;
  sessionId?: string;
  linked: boolean;
}

export class HerdrFocusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HerdrFocusError";
    this.status = status;
  }
}

export async function focusHerdrAgentById(input: {
  agentId: string;
  getSnapshot: () => Promise<HerdrStatusSnapshot>;
  focus: (agentId: string) => Promise<void>;
  sessionRefs: SessionRuntimeReference[];
}): Promise<HerdrFocusResult> {
  const requestedAgentId = input.agentId.trim();
  if (!requestedAgentId) {
    throw new HerdrFocusError(400, "Herdr agent id is required");
  }

  const snapshot = await input.getSnapshot();
  if (snapshot.health !== "ok") {
    throw new HerdrFocusError(503, `Herdr is ${snapshot.health}`);
  }

  const agent = snapshot.agents.find((agent) => agent.id === requestedAgentId);
  if (!agent) {
    throw new HerdrFocusError(404, "Herdr agent not found");
  }

  await input.focus(agent.id);
  const sessionId = resolveSessionId(agent, input.sessionRefs);

  return {
    ok: true,
    focusedAgentId: agent.id,
    agentLabel: agent.label,
    ...(sessionId ? { sessionId } : {}),
    linked: Boolean(sessionId),
  };
}

function resolveSessionId(agent: HerdrAgentRuntimeStatus, sessionRefs: SessionRuntimeReference[]): string | undefined {
  if (agent.sessionId) return agent.sessionId;
  if (!agent.sessionPath) return undefined;
  return sessionRefs.find((ref) => ref.sessionFile === agent.sessionPath)?.sessionId;
}
