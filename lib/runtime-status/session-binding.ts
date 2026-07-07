import type { HerdrAgentRuntimeStatus, SessionRuntimeReference } from "./types";

export function inferSessionIdFromSessionPath(sessionPath: string | undefined): string | undefined {
  if (!sessionPath) return undefined;
  const filename = sessionPath.split(/[\\/]/).pop() ?? "";
  return filename.match(/_([^_\\/]+)\.jsonl$/)?.[1];
}

export function resolveHerdrAgentSessionId(
  agent: HerdrAgentRuntimeStatus,
  sessionRefs: SessionRuntimeReference[],
): string | undefined {
  if (agent.sessionId) return agent.sessionId;
  if (!agent.sessionPath) return undefined;

  return sessionRefs.find((ref) => ref.sessionFile === agent.sessionPath)?.sessionId
    ?? inferSessionIdFromSessionPath(agent.sessionPath);
}
