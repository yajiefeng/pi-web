import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adr1 = readFileSync("docs/adr/0001-herdr-uses-structured-command-channel.md", "utf8");
const adr2 = readFileSync("docs/adr/0002-herdr-owned-sessions-are-read-only-until-command-api.md", "utf8");
const adr3 = readFileSync("docs/adr/0003-new-defaults-to-herdr.md", "utf8");
const adr4 = readFileSync("docs/adr/0004-pi-web-managed-runtime-is-transitional.md", "utf8");
const bridgeSpec = readFileSync("docs/superpowers/specs/2026-07-07-herdr-pi-rpc-bridge-architecture.md", "utf8");
const herdrCreate = readFileSync("lib/runtime-status/herdr-agent-create.ts", "utf8");
const herdrControl = readFileSync("lib/runtime-status/herdr-control.ts", "utf8");

const allArchitectureDocs = [adr1, adr2, adr3, adr4, bridgeSpec].join("\n---\n");
const herdrControlSources = [herdrCreate, herdrControl].join("\n---\n");

assert.match(adr1, /pi-web-rpc-bridge/, "ADR 0001 should name the pi-web-owned RPC bridge");
assert.match(adr1, /pi --mode rpc/, "ADR 0001 should state that the bridge owns Pi RPC stdio");
assert.match(adr1, /Herdr core/i, "ADR 0001 should clarify that Herdr core does not own prompt semantics");

assert.match(adr2, /pi-web-managed/, "ADR 0002 should distinguish pi-web-managed sessions");
assert.match(adr2, /Herdr TUI-owned/, "ADR 0002 should distinguish Herdr TUI-owned sessions");
assert.match(adr2, /Herdr bridge-owned/, "ADR 0002 should distinguish Herdr bridge-owned sessions");
assert.match(adr2, /bridge capability/i, "ADR 0002 should require proven bridge capability before enabling composer");

assert.match(adr3, /pi-web-rpc-bridge/, "ADR 0003 should update new-session startup to the bridge");
assert.match(adr3, /pi --mode rpc/, "ADR 0003 should document the bridge launching Pi RPC");
assert.match(adr3, /plain Pi TUI/i, "ADR 0003 should say plain Pi TUI sessions remain read-only");

assert.match(adr4, /bridge-owned/, "ADR 0004 should mention bridge-owned Herdr sessions as the migration target");
assert.match(adr4, /retire/i, "ADR 0004 should keep the pi-web-managed runtime retirement direction");

assert.match(bridgeSpec, /Herdr[\s\S]*pi-web-rpc-bridge[\s\S]*pi --mode rpc/, "Bridge spec should contain the Herdr → bridge → Pi RPC architecture");
assert.match(bridgeSpec, /Exact Session Binding/, "Bridge spec should preserve exact binding vocabulary");
assert.match(bridgeSpec, /agent_session_id/, "Bridge spec should require agent_session_id binding support");
assert.match(bridgeSpec, /agent_session_path/, "Bridge spec should require agent_session_path binding support");
assert.match(bridgeSpec, /cwd\/latest\/timestamp/i, "Bridge spec should reject cwd/latest/timestamp matching");
assert.match(bridgeSpec, /TUI-owned[\s\S]*read-only/i, "Bridge spec should keep non-bridge Herdr TUI sessions read-only");
assert.match(bridgeSpec, /migration/i, "Bridge spec should cover explicit TUI-to-bridge migration");

assert.match(allArchitectureDocs, /terminal-keystroke fallback remains rejected/i, "Docs should explicitly reject terminal-keystroke fallback");
assert.match(allArchitectureDocs, /herdr agent send/i, "Docs should explicitly name herdr agent send as forbidden for chat routing");
assert.match(allArchitectureDocs, /pane send-text/i, "Docs should explicitly name pane send-text as forbidden for chat routing");
assert.match(allArchitectureDocs, /pane send-keys/i, "Docs should explicitly name pane send-keys as forbidden for chat routing");
assert.match(allArchitectureDocs, /single writer/i, "Docs should preserve the single writer invariant");

assert.doesNotMatch(
  herdrControlSources,
  /agent send|pane send-text|pane send-keys|pane send-input|pane run/i,
  "Herdr control modules must not introduce terminal-keystroke command routing",
);

console.log("Herdr RPC bridge architecture checks passed");
