import assert from "node:assert/strict";
import { mergeRuntimeStatuses } from "../lib/runtime-status/merge.ts";
import { getHerdrStatusSnapshot, parseHerdrAgentList } from "../lib/runtime-status/herdr-adapter.ts";

function rpc(overrides = {}) {
  return {
    sessionId: "session-1",
    sessionFile: "/tmp/session-1.jsonl",
    status: "idle",
    source: "rpc",
    ...overrides,
  };
}

function herdr(overrides = {}) {
  return {
    id: "agent-1",
    label: "pi-main",
    status: "idle",
    linked: true,
    sessionId: "session-1",
    sessionPath: "/tmp/session-1.jsonl",
    source: "herdr",
    ...overrides,
  };
}

{
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [rpc({ status: "working" })],
    herdrAgents: [herdr({ status: "idle" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["session-1"]?.status, "working");
  assert.equal(snapshot.sessions["session-1"]?.source, "merged");
}

{
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [rpc({ status: "idle" })],
    herdrAgents: [herdr({ status: "blocked", message: "waiting for input" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["session-1"]?.status, "blocked");
  assert.equal(snapshot.sessions["session-1"]?.message, "waiting for input");
}

{
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [rpc({ status: "working" })],
    herdrAgents: [herdr({ id: "agent-2", sessionId: undefined, sessionPath: undefined, linked: false, status: "blocked" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["session-1"]?.status, "working");
  assert.equal(snapshot.herdrAgents[0]?.linked, false);
  assert.equal(Object.keys(snapshot.sessions).length, 1);
}

{
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [],
    herdrAgents: [herdr({ status: "working" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["session-1"]?.status, "working");
  assert.equal(snapshot.sessions["session-1"]?.source, "herdr");
}

{
  const agents = parseHerdrAgentList(`id label status cwd agent-session-id\nterm-1 pi-main working cwd=/repo agent-session-id=session-1\nterm-2 pi-review blocked message="waiting for input"`);

  assert.equal(agents.length, 2);
  assert.equal(agents[0]?.status, "working");
  assert.equal(agents[0]?.sessionId, "session-1");
  assert.equal(agents[0]?.linked, true);
  assert.equal(agents[1]?.status, "blocked");
  assert.equal(agents[1]?.message, "waiting for input");
}

{
  const agents = parseHerdrAgentList(JSON.stringify({
    id: "cli:agent:list",
    result: {
      type: "agent_list",
      agents: [{
        agent_status: "unknown",
        cwd: "/Users/fengyajie/agent-lab/bellwether-demo",
        focused: true,
        foreground_cwd: "/Users/fengyajie/agent-lab/bellwether-demo",
        name: "aggregator",
        pane_id: "w5:p1",
        revision: 0,
        tab_id: "w5:t1",
        terminal_id: "term_655acfbdcd4f41",
        workspace_id: "w5",
      }],
    },
  }));

  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.id, "term_655acfbdcd4f41");
  assert.equal(agents[0]?.label, "aggregator");
  assert.equal(agents[0]?.status, "unknown");
  assert.equal(agents[0]?.paneId, "w5:p1");
  assert.equal(agents[0]?.linked, false);
}

{
  const snapshot = await getHerdrStatusSnapshot({
    run: async () => {
      throw new Error("Error: Os { code: 61, kind: ConnectionRefused, message: \"Connection refused\" }");
    },
  });

  assert.equal(snapshot.health, "unavailable");
  assert.deepEqual(snapshot.agents, []);
}

console.log("Runtime status checks passed.");
