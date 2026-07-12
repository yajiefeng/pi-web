import assert from "node:assert/strict";
import { buildSidebarProjection, getRuntimeDiagnosticLabel, getSessionActivityLabel } from "../lib/sidebar-projection.ts";
import { recoverHerdrRuntime } from "../lib/runtime-status/herdr-recovery.ts";
import { stopHerdrRuntimeForSession } from "../lib/runtime-status/session-lifecycle.ts";
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
  const closed = [];
  const snapshots = [
    {
      health: "ok",
      agents: [
        herdr(),
        herdr({ id: "agent-2", sessionId: undefined }),
        herdr({ id: "unrelated", sessionId: "other", sessionPath: "/tmp/other.jsonl" }),
      ],
    },
    { health: "ok", agents: [] },
  ];
  const stopped = await stopHerdrRuntimeForSession(
    { sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl" },
    {
      getSnapshot: async () => snapshots.shift(),
      close: async (agent) => { closed.push(agent.id); },
    },
  );
  assert.equal(stopped, true);
  assert.deepEqual(closed, ["agent-1", "agent-2"], "every runtime bound to the session should stop");

  const pathSnapshots = [
    { health: "ok", agents: [herdr({ sessionId: undefined })] },
    { health: "ok", agents: [] },
  ];
  const stoppedByPath = await stopHerdrRuntimeForSession(
    { sessionId: "missing-id", sessionFile: "/tmp/session-1.jsonl" },
    {
      getSnapshot: async () => pathSnapshots.shift(),
      close: async (agent) => { closed.push(agent.id); },
    },
  );
  assert.equal(stoppedByPath, true);
  assert.deepEqual(closed, ["agent-1", "agent-2", "agent-1"]);

  await assert.rejects(
    stopHerdrRuntimeForSession(
      { sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl" },
      {
        getSnapshot: async () => ({
          health: "ok",
          agents: [herdr({ sessionPath: "/tmp/conflicting-session.jsonl" })],
        }),
        close: async () => { throw new Error("conflicting binding must not be closed"); },
      },
    ),
    /conflicting Herdr binding/i,
  );

  await assert.rejects(
    stopHerdrRuntimeForSession(
      { sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl" },
      {
        getSnapshot: async () => ({ health: "unavailable", agents: [], error: "offline" }),
        close: async () => { throw new Error("must not close without a healthy snapshot"); },
      },
    ),
    /cannot verify Herdr Runtime Owners.*unavailable.*offline/i,
  );

  await assert.rejects(
    stopHerdrRuntimeForSession(
      { sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl" },
      {
        getSnapshot: async () => ({ health: "ok", agents: [herdr()] }),
        close: async () => {},
      },
    ),
    /still bound after shutdown.*agent-1/i,
  );

  const absent = await stopHerdrRuntimeForSession(
    { sessionId: "absent", sessionFile: "/tmp/absent.jsonl" },
    {
      getSnapshot: async () => ({ health: "ok", agents: [herdr()] }),
      close: async () => { throw new Error("must not close unrelated runtime"); },
    },
  );
  assert.equal(absent, false);
}

{
  const actions = [];
  const baseDeps = {
    getSnapshot: async () => ({ health: "ok", agents: [herdr({ id: "diagnostic", cwd: "/repo", linked: false, sessionId: undefined, sessionPath: undefined })] }),
    sessionRefs: [],
    close: async (agent) => { actions.push(["close", agent.id]); },
    start: async (input) => {
      actions.push(["start", input]);
      return { ok: true, agentId: "replacement", agentLabel: "replacement", pending: true, cwd: input.cwd };
    },
    resolveValidSessionFile: () => undefined,
  };

  const cleaned = await recoverHerdrRuntime({ agentId: "diagnostic", action: "cleanup" }, baseDeps);
  assert.equal(cleaned.action, "cleanup");
  assert.deepEqual(actions, [["close", "diagnostic"]]);

  actions.length = 0;
  const retried = await recoverHerdrRuntime(
    { agentId: "diagnostic", action: "retry_binding" },
    {
      ...baseDeps,
      getSnapshot: async () => ({ health: "ok", agents: [herdr({ id: "diagnostic", cwd: "/repo", sessionId: "missing", sessionPath: "/tmp/existing.jsonl" })] }),
      resolveValidSessionFile: (path) => path === "/tmp/existing.jsonl" ? path : undefined,
    },
  );
  assert.equal(retried.action, "retry_binding");
  assert.deepEqual(actions, [
    ["close", "diagnostic"],
    ["start", { cwd: "/repo", sessionFile: "/tmp/existing.jsonl" }],
  ]);

  await assert.rejects(
    recoverHerdrRuntime(
      { agentId: "diagnostic", action: "cleanup" },
      {
        ...baseDeps,
        sessionRefs: [{ sessionId: "session-1", sessionFile: "/tmp/session-1.jsonl" }],
        getSnapshot: async () => ({ health: "ok", agents: [herdr({ id: "diagnostic" })] }),
      },
    ),
    /resolved runtime.*diagnostics/i,
  );
}

function sidebarSession(id, overrides = {}) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/repo",
    created: "2026-07-12T00:00:00.000Z",
    modified: "2026-07-12T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    ...overrides,
  };
}

{
  const sessions = [
    sidebarSession("blocked"),
    sidebarSession("parent", { modified: "2026-07-12T00:03:00.000Z" }),
    sidebarSession("working-child", { parentSessionId: "parent", modified: "2026-07-12T00:04:00.000Z" }),
    sidebarSession("recent", { modified: "2026-07-12T00:02:00.000Z" }),
  ];
  const statuses = new Map([
    ["blocked", { sessionId: "blocked", status: "blocked", source: "herdr", herdrAgentId: "bound-agent" }],
    ["working-child", { sessionId: "working-child", status: "working", source: "herdr", herdrAgentId: "working-agent" }],
    ["missing-session", { sessionId: "missing-session", status: "idle", source: "herdr", herdrAgentId: "stale-binding" }],
  ]);
  const projection = buildSidebarProjection({
    sessions,
    statuses,
    agents: [
      herdr({ id: "bound-agent", cwd: "/repo", sessionId: "blocked" }),
      herdr({ id: "working-agent", cwd: "/repo", sessionId: "working-child" }),
      herdr({ id: "orphan-current-project", cwd: "/repo", linked: false, sessionId: undefined, sessionPath: undefined }),
      herdr({ id: "stale-binding", cwd: "/repo", sessionId: "missing-session" }),
      herdr({ id: "missing-cwd", cwd: undefined, linked: false, sessionId: undefined, sessionPath: undefined }),
      herdr({ id: "other-project", cwd: "/other", linked: false, sessionId: undefined, sessionPath: undefined }),
      herdr({ id: "completed-runtime", cwd: "/repo", status: "done", linked: false, sessionId: undefined, sessionPath: undefined }),
    ],
    selectedCwd: "/repo",
  });

  assert.deepEqual(
    projection.sections.map((section) => [section.key, section.nodes.map((node) => node.session.id)]),
    [["attention", ["blocked"]], ["active", ["parent"]], ["recent", ["recent"]]],
  );
  assert.equal(projection.sections[1].nodes[0].children[0].session.id, "working-child");
  assert.deepEqual(projection.runtimeDiagnostics.map((runtime) => runtime.id), ["orphan-current-project", "stale-binding"]);
  assert.deepEqual(
    buildSidebarProjection({ sessions, statuses, agents: projection.runtimeDiagnostics, selectedCwd: null }).runtimeDiagnostics,
    [],
    "runtime diagnostics should stay empty until a project is selected",
  );
  assert.equal(getRuntimeDiagnosticLabel(projection.runtimeDiagnostics[0]), "Unbound runtime");
  assert.equal(getRuntimeDiagnosticLabel(projection.runtimeDiagnostics[1]), "Stale binding");
  assert.equal(getSessionActivityLabel(statuses.get("blocked")), "Needs input");
  assert.equal(getSessionActivityLabel(statuses.get("working-child")), "Working");
  assert.equal(getSessionActivityLabel(undefined, true), "New activity");
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
  const sessionPath = "/tmp/sessions/2026-07-07T08-40-57-303Z_019f3bbc-ced6-754a-b5a6-bd1e0608737e.jsonl";
  const snapshot = mergeRuntimeStatuses({
    rpcSessions: [],
    sessionRefs: [],
    herdrAgents: [herdr({ sessionId: undefined, sessionPath, status: "idle" })],
    herdrHealth: "ok",
  });

  assert.equal(snapshot.sessions["019f3bbc-ced6-754a-b5a6-bd1e0608737e"]?.status, "idle");
  assert.equal(snapshot.sessions["019f3bbc-ced6-754a-b5a6-bd1e0608737e"]?.sessionFile, sessionPath);
  assert.equal(snapshot.sessions["019f3bbc-ced6-754a-b5a6-bd1e0608737e"]?.herdrAgentId, "agent-1");
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
  assert.equal(
    resolveHerdrAgentSessionId(
      herdr({ sessionId: undefined, sessionPath: "/tmp/2026-07-07T08-40-57-303Z_019f3bbc-ced6-754a-b5a6-bd1e0608737e.jsonl" }),
      [],
    ),
    "019f3bbc-ced6-754a-b5a6-bd1e0608737e",
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
    agentId: "agent-1",
    getSnapshot: async () => ({
      health: "ok",
      agents: [herdr({ sessionId: undefined, sessionPath: "/tmp/2026-07-07T08-40-57-303Z_019f3bbc-ced6-754a-b5a6-bd1e0608737e.jsonl" })],
    }),
    focus: async (agentId) => { focused.push(agentId); },
    sessionRefs: [],
  });

  assert.deepEqual(focused, ["agent-1"]);
  assert.equal(result.sessionId, "019f3bbc-ced6-754a-b5a6-bd1e0608737e");
  assert.equal(result.linked, true);
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
