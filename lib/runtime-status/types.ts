export type RuntimeStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type RuntimeStatusSource = "rpc" | "herdr" | "merged";
export type HerdrHealth = "ok" | "unavailable" | "error";

export interface RpcSessionRuntimeStatus {
  sessionId: string;
  sessionFile?: string;
  status: RuntimeStatus;
  source: "rpc";
  message?: string;
}

export interface HerdrAgentRuntimeStatus {
  id: string;
  label: string;
  status: RuntimeStatus;
  source: "herdr";
  linked: boolean;
  terminalId?: string;
  paneId?: string;
  cwd?: string;
  sessionId?: string;
  sessionPath?: string;
  message?: string;
  raw?: string;
}

export interface SessionRuntimeReference {
  sessionId: string;
  sessionFile?: string;
}

export interface SessionRuntimeStatus {
  sessionId: string;
  sessionFile?: string;
  status: RuntimeStatus;
  source: RuntimeStatusSource;
  message?: string;
  herdrAgentId?: string;
  herdrLabel?: string;
  bridgeCapable?: boolean;
}

export interface RuntimeStatusSnapshot {
  sessions: Record<string, SessionRuntimeStatus>;
  herdrAgents: HerdrAgentRuntimeStatus[];
  health: {
    rpc: "ok";
    herdr: HerdrHealth;
  };
}

export interface HerdrStatusSnapshot {
  agents: HerdrAgentRuntimeStatus[];
  health: HerdrHealth;
  error?: string;
}
