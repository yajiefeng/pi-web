import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  createHerdrAgentResponse,
} = await import("../lib/runtime-status/herdr-agent-create.ts");
const {
  generatePiWebHerdrAgentName,
  HerdrControlError,
  startHerdrAgent,
} = await import("../lib/runtime-status/herdr-control.ts");

function jsonRequest(body) {
  return new Request("http://localhost/api/runtime/herdr/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const tmp = mkdtempSync(join(tmpdir(), "pi-web-herdr-create-test-"));
const projectDir = join(tmp, "pi-web-herdr-create-test");
mkdirSync(projectDir);
try {
  assert.equal(
    generatePiWebHerdrAgentName("/Users/example/projects/pi-web-agegr", { random: () => "a1b2" }),
    "pi-web-pi-web-agegr-a1b2",
  );
  assert.equal(
    generatePiWebHerdrAgentName("/", { random: () => "zz99" }),
    "pi-web-project-zz99",
  );
  assert.doesNotMatch(generatePiWebHerdrAgentName("/tmp/my project!", { random: () => "x1" }), /[\s/!]/);

  {
    const calls = [];
    const result = await startHerdrAgent({ cwd: projectDir, random: () => "a1b2" }, {
      run: async (args, options) => {
        calls.push({ args, timeoutMs: options.timeoutMs });
        return {
          stdout: JSON.stringify({
            id: "cli:agent:start",
            result: {
              agent: {
                terminal_id: "term-new",
                pane_id: "w1:p2",
                name: "pi-web-pi-web-herdr-create-test-a1b2",
                agent_status: "unknown",
              },
            },
          }),
          stderr: "",
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].timeoutMs, 5000);
    assert.deepEqual(calls[0].args.slice(0, 6), ["agent", "start", "pi-web-pi-web-herdr-create-test-a1b2", "--cwd", projectDir, "--"]);
    assert.match(calls[0].args.join(" "), /pi-web-rpc-bridge/, "Herdr creation should start the Pi RPC bridge");
    assert.deepEqual(calls[0].args.slice(-4), ["--", "pi", "--mode", "rpc"], "Bridge should launch Pi in RPC mode");
    assert.deepEqual(result, {
      ok: true,
      agentId: "term-new",
      agentLabel: "pi-web-pi-web-herdr-create-test-a1b2",
      pending: true,
      cwd: projectDir,
    });
    assert.equal("sessionId" in result, false, "creation must not promise a session id");
  }

  {
    const calls = [];
    const sessionFile = join(tmp, "existing-session.jsonl");
    const result = await startHerdrAgent({ cwd: projectDir, sessionFile, random: () => "b7c8" }, {
      run: async (args, options) => {
        calls.push({ args, timeoutMs: options.timeoutMs });
        return {
          stdout: JSON.stringify({
            id: "cli:agent:start",
            result: {
              agent: {
                terminal_id: "term-session",
                pane_id: "w1:p3",
                name: "pi-web-pi-web-herdr-create-test-b7c8",
                agent_status: "unknown",
              },
            },
          }),
          stderr: "",
        };
      },
    });

    assert.equal(result.agentId, "term-session");
    assert.deepEqual(calls[0].args.slice(-5), ["pi", "--mode", "rpc", "--session", sessionFile], "Bridge should launch Pi RPC for the exact selected session file");
  }

  {
    const calls = [];
    const result = await startHerdrAgent({ cwd: projectDir, random: () => "c9d0" }, {
      run: async (args, options) => {
        calls.push({ args, timeoutMs: options.timeoutMs });
        if (args[1] === "start") return { stdout: "", stderr: "" };
        return {
          stdout: JSON.stringify({
            id: "cli:agent:list",
            result: {
              type: "agent_list",
              agents: [
                { terminal_id: "term-other", name: "unrelated", agent_status: "idle" },
                { terminal_id: "term-listed", name: "pi-web-pi-web-herdr-create-test-c9d0", agent_status: "unknown" },
              ],
            },
          }),
          stderr: "",
        };
      },
    });

    assert.deepEqual(calls.map((call) => call.args.slice(0, 2)), [["agent", "start"], ["agent", "list"]]);
    assert.equal(result.agentId, "term-listed");
    assert.equal(result.agentLabel, "pi-web-pi-web-herdr-create-test-c9d0");
    assert.equal("sessionId" in result, false);
  }

  {
    await assert.rejects(
      () => startHerdrAgent({ cwd: projectDir, random: () => "e5f6" }, {
        run: async () => { throw new Error("Connection refused"); },
      }),
      (error) => {
        assert.equal(error.status, 503);
        assert.match(error.message, /failed to start herdr agent/i);
        return true;
      },
    );
  }

  {
    const calls = [];
    const allowedRoots = [];
    const response = await createHerdrAgentResponse(jsonRequest({ cwd: projectDir }), {
      allowRoot: (cwd) => allowedRoots.push(cwd),
      random: () => "c3d4",
      start: async (input) => {
        calls.push(input);
        return {
          ok: true,
          agentId: "term-route",
          agentLabel: "pi-web-pi-web-herdr-create-test-c3d4",
          pending: true,
          cwd: input.cwd,
        };
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.agentId, "term-route");
    assert.equal(body.agentLabel, "pi-web-pi-web-herdr-create-test-c3d4");
    assert.equal(body.pending, true);
    assert.equal(body.cwd, projectDir);
    assert.equal("sessionId" in body, false, "route response must not include sessionId");
    assert.deepEqual(calls, [{ cwd: projectDir, random: calls[0].random }]);
    assert.equal(typeof calls[0].random, "function");
    assert.deepEqual(allowedRoots, [projectDir]);
  }

  {
    const response = await createHerdrAgentResponse(jsonRequest({ cwd: projectDir }), {
      start: async () => { throw new HerdrControlError(503, "Herdr is unavailable"); },
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.match(body.error, /herdr is unavailable/i);
  }

  {
    let called = false;
    const response = await createHerdrAgentResponse(jsonRequest({ cwd: join(tmp, "missing") }), {
      start: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /directory does not exist/i);
    assert.equal(called, false);
  }

  {
    const response = await createHerdrAgentResponse(new Request("http://localhost/api/runtime/herdr/agents", {
      method: "POST",
      body: "not-json",
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /invalid json/i);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("Herdr agent creation checks passed");
