import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  migrateHerdrTuiSessionToBridgeResponse,
} = await import("../lib/runtime-status/herdr-migration.ts");

function jsonRequest(body) {
  return new Request("http://localhost/api/runtime/herdr/migrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const migrateRoute = readFileSync("app/api/runtime/herdr/migrate/route.ts", "utf8");
const migration = readFileSync("lib/runtime-status/herdr-migration.ts", "utf8");
const control = readFileSync("lib/runtime-status/herdr-control.ts", "utf8");

assert.match(chatWindow, /Restart as bridge session/, "Read-only Herdr sessions should offer an explicit bridge migration action");
assert.match(chatWindow, /single writer/i, "Migration confirmation copy should explain the single-writer implication");
assert.match(chatWindow, /Focus Herdr agent/, "Migration UI must preserve Focus Herdr agent");
assert.match(appShell, /handleMigrateReadOnlyHerdrSession/, "AppShell should own read-only Herdr migration action");
assert.match(appShell, /fetch\("\/api\/runtime\/herdr\/migrate"/, "Migration should call the explicit migration API");
assert.match(appShell, /confirmStopOldAgent: true/, "Migration request should include explicit confirmation to stop the old TUI runtime");
assert.match(appShell, /sessionId: selectedSession\.id/, "Migration should use the selected exact session id");
assert.match(appShell, /sessionFile: selectedSession\.path/, "Migration should use the selected exact session file");
assert.match(appShell, /oldAgentId: readOnlyHerdrSession\.agentId/, "Migration should use the exact old Herdr agent binding");

assert.match(migrateRoute, /migrateHerdrTuiSessionToBridgeResponse/, "Migration route should delegate to testable migration logic");
assert.match(migration, /confirmStopOldAgent !== true/, "Migration must refuse without explicit stop confirmation");
assert.match(migration, /sessionId/, "Migration must validate a selected session id");
assert.match(migration, /sessionFile/, "Migration must validate a selected session file");
assert.match(migration, /oldAgentId/, "Migration must validate the exact old Herdr agent id");
assert.match(migration, /getRuntimeStatusSnapshot/, "Migration should verify current runtime ownership before acting");
assert.match(migration, /status\.herdrAgentId !== oldAgentId/, "Migration should reject mismatched selected session/Herdr binding");
assert.match(migration, /closeHerdrAgentPane/, "Migration should close the old pane only after confirmation");
assert.match(migration, /waitForHerdrAgentRelease/, "Migration should verify the old writer is released before starting bridge");
assert.match(migration, /snapshot\.health\.herdr !== "ok"/, "Migration must not assume release when Herdr status is unavailable");
assert.match(migration, /sessionFile: resolvedSessionFile/, "Migration should start the bridge for the same exact session file");
assert.match(control, /"--session", input\.sessionFile/, "Bridge startup should pass the selected session file to Pi RPC");
assert.doesNotMatch(`${appShell}\n${chatWindow}\n${migrateRoute}\n${migration}`, /agent send|pane send-text|pane send-keys|pane send-input|pane run/i,
  "Migration must not use terminal-keystroke fallback");
assert.doesNotMatch(`${migrateRoute}\n${migration}`, /latest|timestamp|mtime/i,
  "Migration must not infer sessions from latest/timestamp matching");

const tmp = mkdtempSync(join(tmpdir(), "pi-web-herdr-migrate-test-"));
const projectDir = join(tmp, "project");
const sessionFile = join(tmp, "session.jsonl");
mkdirSync(projectDir);

const activeSnapshot = {
  sessions: {
    "session-1": {
      sessionId: "session-1",
      sessionFile,
      status: "idle",
      source: "herdr",
      herdrAgentId: "old-agent",
      herdrLabel: "old-tui",
      bridgeCapable: false,
    },
  },
  herdrAgents: [{
    id: "old-agent",
    label: "old-tui",
    status: "idle",
    source: "herdr",
    linked: true,
    paneId: "w1:p1",
    sessionId: "session-1",
    sessionPath: sessionFile,
  }],
  health: { rpc: "ok", herdr: "ok" },
};
const releasedSnapshot = {
  sessions: {},
  herdrAgents: [],
  health: { rpc: "ok", herdr: "ok" },
};
const unhealthyEmptySnapshot = {
  sessions: {},
  herdrAgents: [],
  health: { rpc: "ok", herdr: "error" },
};

try {
  {
    let closed = false;
    let started = false;
    const response = await migrateHerdrTuiSessionToBridgeResponse(jsonRequest({
      sessionId: "session-1",
      sessionFile,
      oldAgentId: "old-agent",
      confirmStopOldAgent: false,
    }), {
      resolveSession: async () => sessionFile,
      getSnapshot: async () => activeSnapshot,
      closeOldAgent: async () => { closed = true; },
      start: async () => {
        started = true;
        throw new Error("must not start");
      },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.errorCode, "confirmation_required");
    assert.equal(closed, false, "old TUI runtime must not be closed without explicit confirmation");
    assert.equal(started, false, "bridge must not start without explicit confirmation");
  }

  {
    let closed = false;
    let started = false;
    const response = await migrateHerdrTuiSessionToBridgeResponse(jsonRequest({
      sessionId: "session-1",
      sessionFile,
      oldAgentId: "old-agent",
      confirmStopOldAgent: true,
    }), {
      resolveSession: async () => sessionFile,
      getSnapshot: async () => activeSnapshot,
      closeOldAgent: async () => { closed = true; },
      readSessionCwd: () => projectDir,
      waitTimeoutMs: 1,
      waitIntervalMs: 0,
      start: async () => {
        started = true;
        throw new Error("must not start while old agent is active");
      },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.errorCode, "old_agent_still_active");
    assert.equal(closed, true, "explicit confirmation should allow stopping the old TUI runtime");
    assert.equal(started, false, "bridge must not start while the old writer still appears active");
  }

  {
    let started = false;
    let releaseChecks = 0;
    const response = await migrateHerdrTuiSessionToBridgeResponse(jsonRequest({
      sessionId: "session-1",
      sessionFile,
      oldAgentId: "old-agent",
      confirmStopOldAgent: true,
    }), {
      resolveSession: async () => sessionFile,
      getSnapshot: async () => releaseChecks++ === 0 ? activeSnapshot : unhealthyEmptySnapshot,
      closeOldAgent: async () => {},
      readSessionCwd: () => projectDir,
      waitTimeoutMs: 1,
      waitIntervalMs: 0,
      start: async () => {
        started = true;
        throw new Error("must not start when Herdr release cannot be confirmed");
      },
    });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.errorCode, "old_agent_still_active");
    assert.equal(started, false, "bridge must not start when Herdr status cannot confirm release");
  }

  {
    const closedAgents = [];
    const startedInputs = [];
    let releaseChecks = 0;
    const response = await migrateHerdrTuiSessionToBridgeResponse(jsonRequest({
      sessionId: "session-1",
      sessionFile,
      oldAgentId: "old-agent",
      confirmStopOldAgent: true,
    }), {
      resolveSession: async () => sessionFile,
      getSnapshot: async () => releaseChecks++ === 0 ? activeSnapshot : releasedSnapshot,
      closeOldAgent: async (agent) => { closedAgents.push(agent); },
      readSessionCwd: () => projectDir,
      start: async (input) => {
        startedInputs.push(input);
        return {
          ok: true,
          agentId: "new-bridge",
          agentLabel: "pi-web-project-abcd",
          pending: true,
          cwd: input.cwd,
        };
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.migrated, true);
    assert.equal(body.previousAgentId, "old-agent");
    assert.equal(body.sessionId, "session-1");
    assert.equal(body.sessionFile, sessionFile);
    assert.equal(closedAgents.length, 1);
    assert.equal(closedAgents[0].id, "old-agent");
    assert.deepEqual(startedInputs, [{ cwd: projectDir, sessionFile }]);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("Herdr bridge migration checks passed");
