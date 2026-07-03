import type { HerdrAgentRuntimeStatus, SessionRuntimeReference } from "./types";

export function resolveHerdrAgentSessionId(
  agent: HerdrAgentRuntimeStatus,
  sessionRefs: SessionRuntimeReference[],
): string | undefined {
  if (agent.sessionId) return agent.sessionId;
  if (!agent.sessionPath) return undefined;

  return sessionRefs.find((ref) => ref.sessionFile === agent.sessionPath)?.sessionId;
}
