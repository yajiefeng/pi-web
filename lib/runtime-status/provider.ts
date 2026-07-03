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
  return mergeRuntimeStatuses({
    rpcSessions,
    herdrAgents: herdr.agents,
    herdrHealth: herdr.health,
    sessionRefs,
  });
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
