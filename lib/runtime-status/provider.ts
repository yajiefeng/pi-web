import { findBridgeRegistryForSession } from "../bridge/rpc-bridge-client";
import { listAllSessions } from "../session-reader";
import { getHerdrStatusSnapshot } from "./herdr-adapter";
import { mergeRuntimeStatuses } from "./merge";
import { getRpcSessionStatuses } from "./rpc-adapter";
import type { RuntimeStatusSnapshot, SessionRuntimeReference } from "./types";

export { mergeRuntimeStatuses, pickRuntimeStatus } from "./merge";

export async function getRuntimeStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
  const rpcSessions = getRpcSessionStatuses();
  const [herdr, sessionRefs] = await Promise.all([
    getHerdrStatusSnapshot(),
    getSessionRefs(),
  ]);
  const snapshot = mergeRuntimeStatuses({
    rpcSessions,
    herdrAgents: herdr.agents,
    herdrHealth: herdr.health,
    sessionRefs,
  });
  await markBridgeCapableSessions(snapshot);
  return snapshot;
}

async function markBridgeCapableSessions(snapshot: RuntimeStatusSnapshot): Promise<void> {
  await Promise.all(Object.values(snapshot.sessions).map(async (session) => {
    if (!session.herdrAgentId) return;
    const bridge = await findBridgeRegistryForSession({
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
    });
    if (bridge) {
      snapshot.sessions[session.sessionId] = { ...session, bridgeCapable: true };
    }
  }));
}

async function getSessionRefs(): Promise<SessionRuntimeReference[]> {
  try {
    const sessions = await listAllSessions();
    return sessions.map((session) => ({
      sessionId: session.id,
      sessionFile: session.path,
    }));
  } catch {
    return [];
  }
}
