import assert from "node:assert/strict";
import { mergeRuntimeStatuses } from "../lib/runtime-status/merge.ts";
import { focusHerdrAgent, getHerdrStatusSnapshot, parseHerdrAgentList } from "../lib/runtime-status/herdr-adapter.ts";
import { focusHerdrAgentById } from "../lib/runtime-status/herdr-focus.ts";
import { resolveHerdrAgentSessionId } from "../lib/runtime-status/session-binding.ts";

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
  const sessionPath = "/Users/fengyajie/.pi/agent/sessions/--Users-fengyajie-github-pi-web-agegr--/2026-07-03T04-22-18-183Z_019f2636-9146-760e-b6b5-c711aa706871.jsonl";
  const agents = parseHerdrAgentList(JSON.stringify({
    id: "cli:agent:list",
    result: {
      type: "agent_list",
      agents: [{
        agent: "pi",
        agent_session: {
          agent: "pi",
          kind: "path",
          source: "herdr:pi",
          value: sessionPath,
        },
        agent_status: "idle",
        cwd: "/Users/fengyajie/github/pi-web-agegr",
        name: "pi-e2e",
        pane_id: "w5:pK",
        terminal_id: "term_655ad45200bd92",
      }],
    },
  }));

  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.status, "idle");
  assert.equal(agents[0]?.sessionPath, sessionPath);
  assert.equal(agents[0]?.linked, true);
}

{
  const sessionPath = "/tmp/session-from-path.jsonl";
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [],
    sessionRefs: [{ sessionId: "session-from-path", sessionFile: sessionPath }],
    herdrAgents: [herdr({ sessionId: undefined, sessionPath, status: "working" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["session-from-path"]?.status, "working");
  assert.equal(snapshot.sessions["session-from-path"]?.source, "herdr");
  assert.equal(snapshot.sessions["session-from-path"]?.herdrAgentId, "agent-1");
}

{
  const calls = [];
  await focusHerdrAgent("term-123", {
    timeoutMs: 42,
    run: async (args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs });
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [{ args: ["agent", "focus", "term-123"], timeoutMs: 42 }]);
}

{
  await assert.rejects(
    () => focusHerdrAgent(" ", { run: async () => ({ stdout: "", stderr: "" }) }),
    /agent id/i,
  );
}

{
  assert.equal(
    resolveHerdrAgentSessionId(
      herdr({ sessionId: undefined, sessionPath: "/tmp/path-session.jsonl" }),
      [{ sessionId: "path-session", sessionFile: "/tmp/path-session.jsonl" }],
    ),
    "path-session",
  );
}

{
  assert.equal(
    resolveHerdrAgentSessionId(herdr({ sessionId: "direct-session", sessionPath: "/tmp/ignored.jsonl" }), []),
    "direct-session",
  );
}

{
  const focused = [];
  const result = await focusHerdrAgentById({
    agentId: "agent-1",
    getSnapshot: async () => ({
      health: "ok",
      agents: [herdr({ sessionId: undefined, sessionPath: "/tmp/path-session.jsonl" })],
    }),
    focus: async (agentId) => { focused.push(agentId); },
    sessionRefs: [{ sessionId: "path-session", sessionFile: "/tmp/path-session.jsonl" }],
  });

  assert.deepEqual(focused, ["agent-1"]);
  assert.deepEqual(result, {
    ok: true,
    focusedAgentId: "agent-1",
    agentLabel: "pi-main",
    sessionId: "path-session",
    linked: true,
  });
}

{
  const focused = [];
  const result = await focusHerdrAgentById({
    agentId: "agent-2",
    getSnapshot: async () => ({
      health: "ok",
      agents: [herdr({ id: "agent-2", sessionId: undefined, sessionPath: undefined, linked: false })],
    }),
    focus: async (agentId) => { focused.push(agentId); },
    sessionRefs: [],
  });

  assert.deepEqual(focused, ["agent-2"]);
  assert.equal(result.linked, false);
  assert.equal(result.sessionId, undefined);
}

{
  const focused = [];
  await assert.rejects(
    () => focusHerdrAgentById({
      agentId: "missing",
      getSnapshot: async () => ({ health: "ok", agents: [herdr()] }),
      focus: async (agentId) => { focused.push(agentId); },
      sessionRefs: [],
    }),
    /not found/i,
  );
  assert.deepEqual(focused, []);
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
