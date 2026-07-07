import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const types = readFileSync("lib/runtime-status/types.ts", "utf8");
const provider = readFileSync("lib/runtime-status/provider.ts", "utf8");
const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const bridgeRouting = readFileSync("app/api/agent/[id]/route.ts", "utf8");

assert.match(types, /bridgeCapable\?: boolean/, "Runtime status should expose bridge capability per session");
assert.match(provider, /findBridgeRegistryForSession/, "Runtime status provider should look up bridge registries");
assert.match(provider, /bridgeCapable: true/, "Runtime status provider should mark exact bridge-owned sessions writable");
assert.match(provider, /sessionFile/, "Bridge capability lookup should include exact session file when available");

assert.match(appShell, /selectedSessionRuntimeStatus\?\.bridgeCapable/, "AppShell should inspect bridge capability for selected Herdr sessions");
assert.match(appShell, /readOnlyHerdrAgentId = selectedSessionRuntimeStatus\?\.herdrAgentId && !selectedSessionRuntimeStatus\?\.bridgeCapable/, "Bridge-capable Herdr sessions should not be read-only");
assert.match(appShell, /readOnlyHerdrSession=\{readOnlyHerdrSession\}/, "ChatWindow should still receive read-only state for non-bridge Herdr sessions");

assert.match(chatWindow, /const composerElement = readOnlyHerdrSession \?[\s\S]*: chatInputElement/, "Non-read-only sessions, including bridge-capable Herdr sessions, should render the normal composer");
assert.match(bridgeRouting, /findBridgeRegistryForSession/, "Writable bridge UI should be backed by bridge route lookup");
assert.match(bridgeRouting, /sendBridgeCommand/, "Writable bridge UI should send through bridge route");

console.log("Herdr bridge UI checks passed");
