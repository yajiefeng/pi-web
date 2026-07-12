import { resolve } from "node:path";
import { getHerdrStatusSnapshot } from "./herdr-adapter.ts";
import { closeHerdrAgentPane } from "./herdr-control.ts";
import type { HerdrAgentRuntimeStatus, HerdrStatusSnapshot } from "./types.ts";

export interface SessionRuntimeReference {
  sessionId: string;
  sessionFile: string;
}

interface SessionRuntimeLifecycleDependencies {
  getSnapshot: () => Promise<HerdrStatusSnapshot>;
  close: (agent: HerdrAgentRuntimeStatus) => Promise<void>;
}

const defaultDependencies: SessionRuntimeLifecycleDependencies = {
  getSnapshot: getHerdrStatusSnapshot,
  close: closeHerdrAgentPane,
};

function requireHealthySnapshot(snapshot: HerdrStatusSnapshot): void {
  if (snapshot.health !== "ok") {
    throw new Error(`Cannot verify Herdr Runtime Owners while Herdr is ${snapshot.health}${snapshot.error ? `: ${snapshot.error}` : ""}`);
  }
}

function ownersForSessions(
  agents: HerdrAgentRuntimeStatus[],
  sessions: SessionRuntimeReference[],
): HerdrAgentRuntimeStatus[] {
  const owners = new Map<string, HerdrAgentRuntimeStatus>();

  for (const session of sessions) {
    const sessionFile = resolve(session.sessionFile);
    for (const agent of agents) {
      const hasSessionId = typeof agent.sessionId === "string";
      const hasSessionPath = typeof agent.sessionPath === "string";
      const idMatches = hasSessionId && agent.sessionId === session.sessionId;
      const pathMatches = hasSessionPath && resolve(agent.sessionPath!) === sessionFile;

      if (hasSessionId && hasSessionPath && idMatches !== pathMatches) {
        throw new Error(`Conflicting Herdr binding for runtime ${agent.id}`);
      }
      if (idMatches || pathMatches) owners.set(agent.id, agent);
    }
  }

  return Array.from(owners.values());
}

/** Stop and verify every Herdr Runtime Owner bound to the affected Pi Sessions. */
export async function stopHerdrRuntimesForSessions(
  sessions: SessionRuntimeReference[],
  dependencies: SessionRuntimeLifecycleDependencies = defaultDependencies,
): Promise<number> {
  const initial = await dependencies.getSnapshot();
  requireHealthySnapshot(initial);
  const owners = ownersForSessions(initial.agents, sessions);

  for (const owner of owners) await dependencies.close(owner);
  if (owners.length === 0) return 0;

  const verification = await dependencies.getSnapshot();
  requireHealthySnapshot(verification);
  const remaining = ownersForSessions(verification.agents, sessions);
  if (remaining.length > 0) {
    throw new Error(`Herdr Runtime Owners are still bound after shutdown: ${remaining.map((agent) => agent.id).join(", ")}`);
  }
  return owners.length;
}

/** Stop the Herdr Runtime Owner bound to one durable Pi Session, if one exists. */
export async function stopHerdrRuntimeForSession(
  session: SessionRuntimeReference,
  dependencies: SessionRuntimeLifecycleDependencies = defaultDependencies,
): Promise<boolean> {
  return (await stopHerdrRuntimesForSessions([session], dependencies)) > 0;
}
