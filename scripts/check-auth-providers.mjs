import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTempAgentDir(callback, authData = {}) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-auth-providers-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  writeFileSync(join(dir, "auth.json"), JSON.stringify(authData, null, 2), "utf8");

  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const { GET } = await import("../app/api/auth/all-providers/route.ts");

await withTempAgentDir(async () => {
  const response = await GET();
  const body = await response.json();
  const doubao = body.providers.find((provider) => provider.id === "volcengine-ark");

  assert.ok(doubao, "Volcengine Agent Plan / Doubao ASR should be available as an API key provider");
  assert.equal(doubao.displayName, "Volcengine Agent Plan / Doubao ASR");
  assert.equal(doubao.configured, false);
  assert.equal(doubao.modelCount, 0);
});

await withTempAgentDir(async () => {
  const response = await GET();
  const body = await response.json();
  const doubao = body.providers.find((provider) => provider.id === "volcengine-ark");

  assert.equal(doubao.configured, true);
  assert.equal(doubao.source, "stored");
}, { "volcengine-ark": { type: "api_key", key: "test-ark-key" } });

const modelsConfig = readFileSync("components/ModelsConfig.tsx", "utf8");
assert.match(modelsConfig, /provider\.description/, "API key settings should show non-model provider descriptions");
assert.match(modelsConfig, /provider\.placeholder/, "API key settings should support provider-specific placeholders");

console.log("auth provider checks passed");
