import type { HerdrAgentRuntimeStatus, HerdrHealth, RpcSessionRuntimeStatus, RuntimeStatus, RuntimeStatusSnapshot, SessionRuntimeStatus } from "./types";

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
}): RuntimeStatusSnapshot {
  const sessions: Record<string, SessionRuntimeStatus> = {};

  for (const rpc of input.rpcSessions) {
    sessions[rpc.sessionId] = {
      sessionId: rpc.sessionId,
      ...(rpc.sessionFile ? { sessionFile: rpc.sessionFile } : {}),
      status: rpc.status,
      source: "rpc",
      ...(rpc.message ? { message: rpc.message } : {}),
    };
  }

  for (const agent of input.herdrAgents) {
    if (!agent.sessionId) continue;

    const existing = sessions[agent.sessionId];
    if (!existing) {
      sessions[agent.sessionId] = {
        sessionId: agent.sessionId,
        ...(agent.sessionPath ? { sessionFile: agent.sessionPath } : {}),
        status: agent.status,
        source: "herdr",
        ...(agent.message ? { message: agent.message } : {}),
        herdrAgentId: agent.id,
        herdrLabel: agent.label,
      };
      continue;
    }

    sessions[agent.sessionId] = {
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
