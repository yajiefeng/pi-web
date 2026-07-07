import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const types = readFileSync("lib/runtime-status/types.ts", "utf8");
const provider = readFileSync("lib/runtime-status/provider.ts", "utf8");
const appShell = readFileSync("components/AppShell.tsx", "utf8");
const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const agentHook = readFileSync("hooks/useAgentSession.ts", "utf8");
const bridgeRouting = readFileSync("app/api/agent/[id]/route.ts", "utf8");
const bridgeEvents = readFileSync("app/api/agent/[id]/events/route.ts", "utf8");

assert.match(types, /bridgeCapable\?: boolean/, "Runtime status should expose bridge capability per session");
assert.match(types, /bridgeProtocolVersion\?: number/, "Runtime status should expose bridge protocol version per session");
assert.match(types, /bridgeCapabilities\?: string\[\]/, "Runtime status should expose bridge capabilities per session");
assert.match(provider, /findBridgeRegistryForSession/, "Runtime status provider should look up bridge registries");
assert.match(provider, /supportsBridgeUiParity/, "Runtime status provider should gate writable bridge UI on protocol/capabilities");
assert.match(provider, /sessionFile/, "Bridge capability lookup should include exact session file when available");

assert.match(appShell, /selectedSessionRuntimeStatus\?\.bridgeCapable/, "AppShell should inspect bridge capability for selected Herdr sessions");
assert.match(appShell, /readOnlyHerdrAgentId = selectedSessionRuntimeStatus\?\.herdrAgentId && !selectedSessionRuntimeStatus\?\.bridgeCapable/, "Bridge-capable Herdr sessions should not be read-only");
assert.match(appShell, /readOnlyHerdrSession=\{readOnlyHerdrSession\}/, "ChatWindow should still receive read-only state for non-bridge Herdr sessions");

assert.match(chatWindow, /const composerElement = readOnlyHerdrSession \?[\s\S]*: chatInputElement/, "Non-read-only sessions, including bridge-capable Herdr sessions, should render the normal composer");
assert.match(bridgeRouting, /findBridgeRegistryForSession/, "Writable bridge UI should be backed by bridge route lookup");
assert.match(bridgeRouting, /sendBridgeCommand/, "Writable bridge UI should send through bridge route");
assert.match(bridgeRouting, /extension_ui_response/, "Extension UI responses should be allowed through the bridge route");
assert.match(bridgeEvents, /subscribeBridgeEvents/, "Extension UI requests should arrive through bridge event subscription");
assert.match(agentHook, /Unsupported extension UI request/, "Unsupported extension UI request methods should fail visibly instead of hanging");
assert.match(agentHook, /cancelled: true/, "Unsupported extension UI request methods should be cancelled when possible");

console.log("Herdr bridge UI checks passed");
