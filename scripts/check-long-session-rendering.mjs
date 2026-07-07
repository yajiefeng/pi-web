import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatWindow = readFileSync("components/ChatWindow.tsx", "utf8");

assert.match(chatWindow, /INITIAL_RENDER_MESSAGE_LIMIT = 300/, "ChatWindow should cap initial long-session rendering");
assert.match(chatWindow, /messages\.slice\(renderStartIndex\)/, "ChatWindow should render a tail slice for long sessions");
assert.match(chatWindow, /Load all messages/, "Users should be able to opt into rendering the full session");
assert.match(chatWindow, /messages=\{renderedMessages\}/, "Chat minimap should use the rendered message slice so refs stay aligned");

console.log("Long session rendering checks passed");
