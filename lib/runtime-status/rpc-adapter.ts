import { getRpcSessionStatusSnapshot } from "../rpc-manager";
import type { RpcSessionRuntimeStatus } from "./types";

export function getRpcSessionStatuses(): RpcSessionRuntimeStatus[] {
  return getRpcSessionStatusSnapshot();
}
