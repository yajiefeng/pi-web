import type { HerdrAgentRuntimeStatus, HerdrHealth, RpcSessionRuntimeStatus, RuntimeStatus, RuntimeStatusSnapshot, SessionRuntimeReference, SessionRuntimeStatus } from "./types";

const STATUS_PRIORITY: Record<RuntimeStatus, number> = {
  unknown: 0,
  done: 1,
  idle: 2,
  working: 3,
  blocked: 4,
};

export function pickRuntimeStatus(a: RuntimeStatus, b: RuntimeStatus): RuntimeStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}

export function mergeRuntimeStatuses(input: {
  rpcSessions: RpcSessionRuntimeStatus[];
  herdrAgents: HerdrAgentRuntimeStatus[];
  herdrHealth: HerdrHealth;
  sessionRefs?: SessionRuntimeReference[];
}): RuntimeStatusSnapshot {
  const sessions: Record<string, SessionRuntimeStatus> = {};
  const sessionIdByPath = new Map<string, string>();

  for (const ref of input.sessionRefs ?? []) {
    if (ref.sessionFile) sessionIdByPath.set(ref.sessionFile, ref.sessionId);
  }

  for (const rpc of input.rpcSessions) {
    if (rpc.sessionFile) sessionIdByPath.set(rpc.sessionFile, rpc.sessionId);
    sessions[rpc.sessionId] = {
      sessionId: rpc.sessionId,
      ...(rpc.sessionFile ? { sessionFile: rpc.sessionFile } : {}),
      status: rpc.status,
      source: "rpc",
      ...(rpc.message ? { message: rpc.message } : {}),
    };
  }

  for (const agent of input.herdrAgents) {
    const sessionId = agent.sessionId ?? (agent.sessionPath ? sessionIdByPath.get(agent.sessionPath) : undefined);
    if (!sessionId) continue;

    const existing = sessions[sessionId];
    if (!existing) {
      sessions[sessionId] = {
        sessionId,
        ...(agent.sessionPath ? { sessionFile: agent.sessionPath } : {}),
        status: agent.status,
        source: "herdr",
        ...(agent.message ? { message: agent.message } : {}),
        herdrAgentId: agent.id,
        herdrLabel: agent.label,
      };
      continue;
    }

    sessions[sessionId] = {
      ...existing,
      sessionFile: existing.sessionFile ?? agent.sessionPath,
      status: pickRuntimeStatus(existing.status, agent.status),
      source: "merged",
      message: agent.message ?? existing.message,
      herdrAgentId: agent.id,
      herdrLabel: agent.label,
    };
  }

  return {
    sessions,
    herdrAgents: input.herdrAgents,
    health: {
      rpc: "ok",
      herdr: input.herdrHealth,
    },
  };
}
