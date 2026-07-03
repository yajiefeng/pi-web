import { getHerdrStatusSnapshot } from "./herdr-adapter";
import { mergeRuntimeStatuses } from "./merge";
import { getRpcSessionStatuses } from "./rpc-adapter";
import type { RuntimeStatusSnapshot } from "./types";

export { mergeRuntimeStatuses, pickRuntimeStatus } from "./merge";

export async function getRuntimeStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
  const rpcSessions = getRpcSessionStatuses();
  const herdr = await getHerdrStatusSnapshot();
  return mergeRuntimeStatuses({
    rpcSessions,
    herdrAgents: herdr.agents,
    herdrHealth: herdr.health,
  });
}
