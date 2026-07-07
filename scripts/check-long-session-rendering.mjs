import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");
const hook = readFileSync("hooks/useAgentSession.ts", "utf8");
const sessionRoute = readFileSync("app/api/sessions/[id]/route.ts", "utf8");

assert.match(hook, /INITIAL_SESSION_MESSAGE_LIMIT = 300/, "Session loading should cap initial long-session payloads");
assert.match(hook, /messageLimit/, "Session loading should request a server-side message limit");
assert.match(hook, /loadAllMessages/, "Users should be able to request the full session after initial tail load");
assert.match(sessionRoute, /limitSessionContext/, "Session API should support tail-limited contexts");
assert.match(sessionRoute, /messages: context\.messages\.slice\(-messageLimit\)/, "Session API should return only the latest messages when limited");
assert.match(chatWindow, /Load all messages/, "Long sessions should expose a Load all messages control");
assert.match(chatWindow, /void loadAllMessages\(\)/, "Load all messages should fetch the complete session context");
assert.match(chatWindow, /messages=\{renderedMessages\}/, "Chat minimap should use the rendered messages so refs stay aligned");

console.log("Long session rendering checks passed");
